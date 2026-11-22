/**
 * Amazon SNS SMS Service
 *
 * HIPAA-eligible under the AWS BAA this practice already has - no separate
 * vendor BAA needed, unlike Twilio (quoted $1000/mo, declined 2026-10-20).
 * Uses the ECS task role's AWS credentials, no API key.
 *
 * SNS's direct-to-phone-number Publish is one-way only: there is no inbound
 * webhook / reply-handling equivalent to Twilio's. Fine for the one-way
 * notifications this app sends (reminders, waitlist offers, review
 * requests); a "Reply CONFIRM/YES" instruction in the message text is
 * cosmetic here, since nothing is listening for the reply.
 */

import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

let client: SNSClient | null = null;

function getClient(): SNSClient {
  if (!client) {
    client = new SNSClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return client;
}

export function isSnsSmsAvailable(): boolean {
  return true; // Credentials come from the task role, not an API key - always "configured".
}

/**
 * Format phone number to E.164 format (same rule as the Twilio path, kept
 * in sync deliberately rather than shared, so each provider's input
 * validation stays self-contained).
 */
function formatPhoneNumber(phone: string): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  } else if (digits.startsWith("+")) {
    return phone;
  }

  return null;
}

export async function sendSMS(to: string, message: string): Promise<SMSResult> {
  const formattedPhone = formatPhoneNumber(to);
  if (!formattedPhone) {
    return { success: false, error: "Invalid phone number format" };
  }

  try {
    const result = await getClient().send(
      new PublishCommand({
        PhoneNumber: formattedPhone,
        Message: message,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": {
            DataType: "String",
            StringValue: "Transactional",
          },
        },
      })
    );

    return {
      success: true,
      messageId: result.MessageId,
    };
  } catch (error) {
    console.error("SNS SMS send error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send SMS",
    };
  }
}

export default {
  isSnsSmsAvailable,
  sendSMS,
};
