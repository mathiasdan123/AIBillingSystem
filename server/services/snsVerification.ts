/**
 * Thin promisified wrapper around sns-validator, used by the SES
 * bounce/complaint webhook (server/routes/sesNotifications.ts).
 *
 * sns-validator's default hostPattern already restricts which host the
 * signing certificate can be fetched from to genuine AWS SNS endpoints
 * (sns.<region>.amazonaws.com[.cn]), so this rejects a forged message
 * before ever making an outbound request to an attacker-controlled URL.
 */

import MessageValidator from "sns-validator";

const validator = new MessageValidator();

export function validateSnsMessage(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    validator.validate(raw, (err, message) => {
      if (err || !message) {
        reject(err || new Error("SNS message validation failed"));
        return;
      }
      resolve(message);
    });
  });
}
