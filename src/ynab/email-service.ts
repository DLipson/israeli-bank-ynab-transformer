import nodemailer from "nodemailer";

export interface SendEmailInput {
  smtpUser: string;
  smtpAppPassword: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}

interface SendMailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface EmailTransport {
  sendMail(payload: SendMailPayload): Promise<unknown>;
}

function validateInput(input: SendEmailInput): void {
  const missing: string[] = [];
  if (!input.smtpUser.trim()) missing.push("smtpUser");
  if (!input.smtpAppPassword.trim()) missing.push("smtpAppPassword");
  if (!input.to.trim()) missing.push("to");
  if (!input.subject.trim()) missing.push("subject");
  if (!input.html.trim()) missing.push("html");
  if (!input.text.trim()) missing.push("text");

  if (missing.length > 0) {
    throw new Error(`Missing required email fields: ${missing.join(", ")}`);
  }
}

function createTransport(smtpUser: string, smtpAppPassword: string): EmailTransport {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: smtpUser,
      pass: smtpAppPassword,
    },
  });
}

export async function sendEmail(
  input: SendEmailInput,
  transportFactory: (smtpUser: string, smtpAppPassword: string) => EmailTransport = createTransport
): Promise<void> {
  validateInput(input);

  const transport = transportFactory(input.smtpUser, input.smtpAppPassword);
  const fromName = input.fromName?.trim() || "YNAB Reporter";
  const from = `${fromName} <${input.smtpUser}>`;

  await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}
