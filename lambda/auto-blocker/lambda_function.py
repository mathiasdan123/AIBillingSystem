"""
Auto-blocker Lambda for TherapyBill AI.

Triggered by SNS when therapybill-high-401-rate fires. Queries WAF logs
for the previous 10 minutes, identifies any IP that sent more than
THRESHOLD requests, and adds it to the therapybill-scanner-blocklist —
UNLESS the IP is in the allowlist (SSM parameter
/therapybill/security/known-tooling-ips).

Sends an SNS notification (therapybill-waf-alerts) summarizing every
firing: what was blocked, what was skipped because allowlisted, what
was already in the blocklist. So the on-call doesn't have to log into
the console to know what just happened.

Idempotent: skips IPs already in the blocklist. Defensive: never blocks
private/internal CIDRs, never blocks an allowlisted IP.
"""
import json
import time
import ipaddress
import os
import boto3

REGION = "us-east-1"
WAF_LOG_GROUP = "aws-waf-logs-therapybill-production"
IPSET_NAME = "therapybill-scanner-blocklist"
IPSET_ID = "e1eefff7-61fc-4019-9b98-0a20b3427e78"
IPSET_SCOPE = "REGIONAL"
THRESHOLD = 100  # min requests to qualify as "scanner"
# WAF logs to CloudWatch can lag 2-5 minutes. A 10-min lookback miss this
# delay if the spike happened just before the alarm fired (verified post-mortem
# on the 5-09 incident — Lambda invoked, ran a clean query, returned empty
# because the spike traffic hadn't been ingested yet). 15 minutes gives a
# comfortable buffer.
LOOKBACK_MINUTES = 15
ALLOWLIST_PARAMETER = "/therapybill/security/known-tooling-ips"
NOTIFY_TOPIC_ARN = os.environ.get(
    "NOTIFY_TOPIC_ARN",
    "arn:aws:sns:us-east-1:773320320189:therapybill-waf-alerts",
)

logs = boto3.client("logs", region_name=REGION)
wafv2 = boto3.client("wafv2", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)
sns = boto3.client("sns", region_name=REGION)


def is_internal_ip(ip_str: str) -> bool:
    """Refuse to ever block our own infrastructure or known-good ranges."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        )
    except ValueError:
        return True  # if we can't parse it, don't block


def load_allowlist() -> list:
    """Fetch the known-tooling allowlist from SSM Parameter Store.

    The parameter is a StringList of CIDRs (or single IPs). Comments are
    not supported in SSM StringList values — keep human-readable
    documentation in scripts/known-tooling-ips.txt and sync to SSM via
    scripts/sync-allowlist-to-ssm.sh.

    Returns parsed list of ipaddress.ip_network objects. Empty on any
    error so we fail open (block the offender) rather than fail closed
    (skip everything).
    """
    try:
        resp = ssm.get_parameter(Name=ALLOWLIST_PARAMETER)
        raw = resp["Parameter"]["Value"]
        if not raw or raw.strip() == "":
            return []
        entries = [e.strip() for e in raw.split(",") if e.strip()]
        networks = []
        for entry in entries:
            try:
                networks.append(ipaddress.ip_network(entry, strict=False))
            except ValueError:
                print(f"  WARN: bad allowlist entry, skipping: {entry!r}")
        return networks
    except ssm.exceptions.ParameterNotFound:
        print(f"  Allowlist parameter {ALLOWLIST_PARAMETER} not found — treating as empty")
        return []
    except Exception as e:
        print(f"  WARN: failed to load allowlist ({type(e).__name__}: {e}) — treating as empty")
        return []


def ip_in_allowlist(ip_str: str, allowlist: list) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
        return any(ip in net for net in allowlist)
    except ValueError:
        return False


def notify(subject: str, body: str) -> None:
    """Best-effort SNS notification — never raise (notification failure
    must not block the actual remediation)."""
    if not NOTIFY_TOPIC_ARN:
        return
    try:
        sns.publish(TopicArn=NOTIFY_TOPIC_ARN, Subject=subject[:100], Message=body)
    except Exception as e:
        print(f"  WARN: SNS publish failed: {e}")


def lambda_handler(event, context):
    print(f"Triggered. Event: {json.dumps(event)[:500]}")

    end = int(time.time())
    start = end - LOOKBACK_MINUTES * 60

    allowlist = load_allowlist()
    print(f"Allowlist has {len(allowlist)} entries")

    # Query top offending IPs from the past LOOKBACK_MINUTES
    query = (
        'fields httpRequest.clientIp '
        '| stats count(*) as cnt by httpRequest.clientIp '
        '| sort cnt desc | limit 10'
    )
    qid = logs.start_query(
        logGroupName=WAF_LOG_GROUP,
        startTime=start,
        endTime=end,
        queryString=query,
    )["queryId"]

    for _ in range(30):
        time.sleep(1)
        r = logs.get_query_results(queryId=qid)
        if r["status"] == "Complete":
            break
    else:
        print("Query timed out")
        notify(
            "TherapyBill auto-blocker: query timeout",
            "WAF Logs Insights query did not complete within 30s. Run the manual "
            "triage script:\n  scripts/triage-401-spike.sh --hours 1",
        )
        return {"status": "query_timeout"}

    candidates = []
    for row in r["results"]:
        ip = next((f["value"] for f in row if f["field"] == "httpRequest.clientIp"), None)
        cnt_str = next((f["value"] for f in row if f["field"] == "cnt"), "0")
        try:
            cnt = int(cnt_str)
        except ValueError:
            continue
        if not ip:
            continue
        candidates.append((ip, cnt))

    # Get current blocklist
    ipset = wafv2.get_ip_set(Name=IPSET_NAME, Scope=IPSET_SCOPE, Id=IPSET_ID)
    current_blocklist = set(ipset["IPSet"]["Addresses"])
    lock = ipset["LockToken"]

    # Classify each candidate
    to_block = []         # (ip, cnt) — over threshold, not allowlisted, not blocked
    skipped_low = []      # (ip, cnt) — below threshold
    skipped_internal = []
    skipped_allowlisted = []
    skipped_already_blocked = []
    for ip, cnt in candidates:
        if is_internal_ip(ip):
            skipped_internal.append((ip, cnt))
            continue
        if f"{ip}/32" in current_blocklist:
            skipped_already_blocked.append((ip, cnt))
            continue
        if cnt < THRESHOLD:
            skipped_low.append((ip, cnt))
            continue
        if ip_in_allowlist(ip, allowlist):
            skipped_allowlisted.append((ip, cnt))
            continue
        to_block.append((ip, cnt))

    blocked_now = []
    if to_block:
        updated = list(current_blocklist) + [f"{ip}/32" for ip, _ in to_block]
        wafv2.update_ip_set(
            Name=IPSET_NAME,
            Scope=IPSET_SCOPE,
            Id=IPSET_ID,
            Addresses=updated,
            LockToken=lock,
        )
        blocked_now = to_block

    print(f"Blocked now: {blocked_now}")
    print(f"Skipped (allowlisted): {skipped_allowlisted}")
    print(f"Skipped (already blocked): {skipped_already_blocked}")

    # Notification
    lines = ["TherapyBill high-401-rate alarm fired. Summary:"]
    lines.append(f"  Window: last {LOOKBACK_MINUTES} min")
    lines.append("")
    if blocked_now:
        lines.append(f"BLOCKED ({len(blocked_now)}):")
        for ip, cnt in blocked_now:
            lines.append(f"  {ip}  ({cnt} requests)")
        lines.append("")
    if skipped_allowlisted:
        lines.append(f"SKIPPED — on allowlist ({len(skipped_allowlisted)}):")
        for ip, cnt in skipped_allowlisted:
            lines.append(f"  {ip}  ({cnt} requests) — investigate why your tooling is hitting this hard")
        lines.append("")
    if skipped_already_blocked:
        lines.append(f"Already blocked ({len(skipped_already_blocked)}):")
        for ip, cnt in skipped_already_blocked:
            lines.append(f"  {ip}  ({cnt} requests)")
        lines.append("")
    if not blocked_now and not skipped_allowlisted and not skipped_already_blocked:
        lines.append("No IPs above threshold. Alarm may have fired on a distributed pattern —")
        lines.append("run scripts/triage-401-spike.sh for a wider view.")
        if skipped_low:
            lines.append("")
            lines.append(f"Top sub-threshold IPs ({len(skipped_low)}):")
            for ip, cnt in skipped_low[:5]:
                lines.append(f"  {ip}  ({cnt} requests)")
    lines.append("")
    lines.append("Allowlist editing: scripts/known-tooling-ips.txt + scripts/sync-allowlist-to-ssm.sh")
    notify(
        f"TherapyBill auto-blocker: {len(blocked_now)} blocked, {len(skipped_allowlisted)} on allowlist",
        "\n".join(lines),
    )

    return {
        "status": "ok",
        "blocked": [ip for ip, _ in blocked_now],
        "allowlisted_skipped": [ip for ip, _ in skipped_allowlisted],
        "already_blocked": [ip for ip, _ in skipped_already_blocked],
    }
