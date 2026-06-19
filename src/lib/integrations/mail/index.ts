import "server-only";
import nodemailer from "nodemailer";

export interface MailAttachment { filename: string; path: string; contentType?: string; }
export interface MailMessage { to: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export interface SendResult { providerMessageId: string | null; }
export interface MailTransport {
  sendMail(opts: {
    from: string; to: string; subject: string; html: string; attachments?: MailAttachment[];
  }): Promise<{ messageId?: string }>;
}

// 테스트 전용 transport 주입. 실제 SMTP 대신 fake를 꽂는다.
let testTransport: MailTransport | null = null;
export function setMailTransportForTests(t: MailTransport | null): void {
  testTransport = t;
}

const SIGNATURE_HTML =
  '<hr style="margin-top:24px"/><p style="color:#888;font-size:12px">본 메일은 ops-hub에서 자동 발송되었습니다.</p>';

function buildTransport(): MailTransport {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST가 설정되지 않았습니다.");
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  }) as unknown as MailTransport;
}

// trim + 대소문자 무시 중복 제거(첫 표기 보존).
function normalizeRecipients(to: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of to) {
    const t = raw.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  if (out.length === 0) throw new Error("수신자가 없습니다.");
  return out.join(", ");
}

export async function sendMail(msg: MailMessage): Promise<SendResult> {
  const transport = testTransport ?? buildTransport();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@uracle.co.kr";
  const info = await transport.sendMail({
    from,
    to: normalizeRecipients(msg.to),
    subject: msg.subject,
    html: msg.html + SIGNATURE_HTML,
    attachments: msg.attachments,
  });
  return { providerMessageId: info.messageId ?? null };
}
