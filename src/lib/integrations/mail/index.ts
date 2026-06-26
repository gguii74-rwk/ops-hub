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

// 전송 config 타입(D3·F1): 메일 lib이 소유한다. kernel getSmtpConfig가 이 타입을 채택(kernel→lib 허용).
// 비밀번호는 여기 없다 — sendMail이 process.env.SMTP_PASSWORD에서 직접 읽는다(D2: secret은 config로 흐르지 않음).
export interface MailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}

// 테스트 전용 transport 주입. 실제 SMTP 대신 fake를 꽂는다.
let testTransport: MailTransport | null = null;
export function setMailTransportForTests(t: MailTransport | null): void {
  testTransport = t;
}

const SIGNATURE_HTML =
  '<hr style="margin-top:24px"/><p style="color:#888;font-size:12px">본 메일은 ops-hub에서 자동 발송되었습니다.</p>';

// config 주입 시: host/port/secure/user를 config에서, pass는 env(D2). 미주입 시: 현행 env-only 동작 보존.
function buildTransport(config?: MailTransportConfig): MailTransport {
  const host = config ? config.host : process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST가 설정되지 않았습니다.");
  const port = config ? config.port : Number(process.env.SMTP_PORT ?? 587);
  const secure = config ? config.secure : process.env.SMTP_SECURE === "true";
  const user = config ? config.user : (process.env.SMTP_USER ?? "");
  return nodemailer.createTransport({
    host,
    port,
    secure,
    // user 비어있으면 무인증 릴레이(auth undefined) — 전송 auth 분기. pass는 항상 env(D2).
    auth: user ? { user, pass: process.env.SMTP_PASSWORD } : undefined,
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

export async function sendMail(msg: MailMessage, config?: MailTransportConfig): Promise<SendResult> {
  const transport = testTransport ?? buildTransport(config);
  // config.from은 getSmtpConfig가 항상 비어있지 않게 보장. 미주입 시 기존 env 폴백 체인.
  const from = config?.from || process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@uracle.co.kr";
  const info = await transport.sendMail({
    from,
    to: normalizeRecipients(msg.to),
    subject: msg.subject,
    html: msg.html + SIGNATURE_HTML,
    attachments: msg.attachments,
  });
  return { providerMessageId: info.messageId ?? null };
}
