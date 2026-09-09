import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Landmark, ShieldCheck, RefreshCw, Loader2, AlertTriangle, CheckCircle2, CircleDollarSign,
} from "lucide-react";

// ==================== Types ====================

interface ConnectedBank {
  id: number;
  institutionName: string | null;
  status: string;
  accounts: Array<{ name: string | null; mask: string | null; subtype: string | null }>;
}

interface DepositException {
  id: number;
  type: "missing_deposit" | "amount_mismatch" | "unmatched_deposit";
  detail: string;
  status: "open" | "in_progress" | "resolved";
  assignee: string | null;
  notes: string | null;
  openedAt: string;
}

interface Statement {
  period: { from: string; to: string };
  remittedCents: number;
  depositedConfirmedCents: number;
  awaitingDeposit: Array<{
    remittanceId: number;
    payerName: string;
    effectiveDate: string;
    amountCents: number;
    exception: boolean;
  }>;
}

declare global {
  interface Window {
    Plaid?: { create: (opts: any) => { open: () => void } };
  }
}

const EXCEPTION_LABELS: Record<DepositException["type"], string> = {
  missing_deposit: "Missing deposit",
  amount_mismatch: "Amount mismatch",
  unmatched_deposit: "Unmatched deposit",
};

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function monthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(now) };
}

async function loadPlaidScript(): Promise<void> {
  if (window.Plaid) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the bank connection widget"));
    document.head.appendChild(s);
  });
}

// ==================== Page ====================

export default function Deposits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const period = monthRange();

  const { data: banks = [], isLoading: banksLoading } = useQuery<ConnectedBank[]>({
    queryKey: ["/api/reconciliation/items"],
  });
  const { data: statement } = useQuery<Statement>({
    queryKey: [`/api/reconciliation/statement?from=${period.from}&to=${period.to}`],
  });
  const { data: exceptions = [] } = useQuery<DepositException[]>({
    queryKey: ["/api/reconciliation/exceptions"],
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/reconciliation/items"] });
    queryClient.invalidateQueries({ queryKey: [`/api/reconciliation/statement?from=${period.from}&to=${period.to}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/reconciliation/exceptions"] });
  };

  const runMatching = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reconciliation/run");
      return res.json();
    },
    onSuccess: (data: { matches: number; newExceptions: number }) => {
      toast({
        title: "Reconciliation complete",
        description: `${data.matches} deposit${data.matches === 1 ? "" : "s"} matched, ${data.newExceptions} new exception${data.newExceptions === 1 ? "" : "s"}.`,
      });
      refreshAll();
    },
    onError: () => toast({ title: "Reconciliation failed", description: "Please try again.", variant: "destructive" }),
  });

  const updateException = useMutation({
    mutationFn: async (input: { id: number; status?: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/reconciliation/exceptions/${input.id}`, input);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/reconciliation/exceptions"] }),
    onError: () => toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
  });

  const connectBank = async () => {
    setConnecting(true);
    try {
      await loadPlaidScript();
      const res = await apiRequest("POST", "/api/reconciliation/link-token");
      const { linkToken, message } = await res.json();
      if (!linkToken) throw new Error(message || "Could not start the bank connection");
      window.Plaid!.create({
        token: linkToken,
        onSuccess: async (publicToken: string) => {
          try {
            await apiRequest("POST", "/api/reconciliation/exchange", { publicToken });
            toast({ title: "Bank connected", description: "Deposits will sync automatically from now on." });
            refreshAll();
          } catch {
            toast({ title: "Connection failed", description: "Please try again.", variant: "destructive" });
          } finally {
            setConnecting(false);
          }
        },
        onExit: () => setConnecting(false),
      }).open();
    } catch (err: any) {
      setConnecting(false);
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    }
  };

  const awaiting = statement?.awaitingDeposit ?? [];

  return (
    <div className="space-y-6 p-6" data-testid="deposits-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Deposits</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Verify that every insurance payment actually arrives in your bank account.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runMatching.mutate()} disabled={runMatching.isPending}>
            {runMatching.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run matching
          </Button>
          <Button onClick={connectBank} disabled={connecting}>
            {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Landmark className="h-4 w-4 mr-2" />}
            Connect bank account
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Remitted this month</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{usd(statement?.remittedCents ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">What payers say they paid</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deposited &amp; confirmed</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-green-700 dark:text-green-400">
              {usd(statement?.depositedConfirmedCents ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Verified in your bank account</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Awaiting deposit</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {usd((statement?.remittedCents ?? 0) - (statement?.depositedConfirmedCents ?? 0))}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {awaiting.filter((a) => a.exception).length > 0
              ? `${awaiting.filter((a) => a.exception).length} flagged for follow-up`
              : "Within the normal settlement window"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-green-600" /> Connected banks
          </CardTitle>
          <CardDescription>
            Read-only access — we can see deposits, we can never move money. You sign in with your own bank and can
            disconnect at any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {banksLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : banks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bank connected yet. Connect your operating account to start verifying deposits.
            </p>
          ) : (
            <ul className="space-y-2">
              {banks.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{b.institutionName ?? "Bank"}</span>
                    {b.status === "login_required" && (
                      <Badge variant="destructive">Reconnect needed</Badge>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {b.accounts.map((a) => `${a.name ?? "Account"} ••${a.mask ?? "????"}`).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {awaiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="h-4 w-4" /> Awaiting deposit
            </CardTitle>
            <CardDescription>Remittances not yet confirmed in the bank account this month.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {awaiting.map((a) => (
                <li key={a.remittanceId} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {a.payerName} <span className="text-muted-foreground">· remitted {a.effectiveDate}</span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {usd(a.amountCents)}
                    {a.exception ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Flagged
                      </Badge>
                    ) : (
                      <Badge variant="secondary">In window</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exception queue</CardTitle>
          <CardDescription>
            Deposits that need a human: remitted-but-missing money, amount mismatches, and deposits with no matching
            remittance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Nothing needs attention.
            </p>
          ) : (
            <ul className="space-y-3">
              {exceptions.map((ex) => (
                <ExceptionRow key={ex.id} exception={ex} onUpdate={(patch) => updateException.mutate({ id: ex.id, ...patch })} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ExceptionRow({
  exception,
  onUpdate,
}: {
  exception: DepositException;
  onUpdate: (patch: { status?: string; notes?: string }) => void;
}) {
  const [notes, setNotes] = useState(exception.notes ?? "");
  return (
    <li className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant={exception.type === "missing_deposit" ? "destructive" : "secondary"}>
            {EXCEPTION_LABELS[exception.type]}
          </Badge>
          {exception.status === "in_progress" && <Badge variant="outline">In progress{exception.assignee ? ` · ${exception.assignee}` : ""}</Badge>}
        </div>
        <div className="flex gap-2">
          {exception.status === "open" && (
            <Button size="sm" variant="outline" onClick={() => onUpdate({ status: "in_progress" })}>
              Start working
            </Button>
          )}
          <Button size="sm" onClick={() => onUpdate({ status: "resolved", notes })}>
            Resolve
          </Button>
        </div>
      </div>
      <p className="text-sm">{exception.detail}</p>
      <Textarea
        placeholder="Notes (what happened, who you called, ETA...)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (exception.notes ?? "") && onUpdate({ notes })}
        rows={2}
      />
    </li>
  );
}
