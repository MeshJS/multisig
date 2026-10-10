import { Resend } from "resend";

import { env } from "@/env";
import type { EmailMessage, EmailSendResult } from "./types";

let resendClient: Resend | null = null;

function getResendClient() {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export async function sendEmailViaResend(
  message: EmailMessage,
): Promise<EmailSendResult> {
  if (!env.EMAIL_FROM) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const resend = getResendClient();
  const response = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const messageId = response.data?.id;
  if (!messageId) {
    throw new Error("Resend did not return a message id");
  }

  return { provider: "resend", messageId };
}
