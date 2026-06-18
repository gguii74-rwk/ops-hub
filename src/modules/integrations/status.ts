import "server-only";
import { getSecretStatus } from "@/lib/env";
import { getSetting, SettingInvalidError } from "@/kernel/settings/reader";
import { hasPermission } from "@/kernel/access";

export type IntegrationKey = "smtp" | "google" | "templates";
export type IntegrationHealth = "configured" | "attention_required" | "unknown";
export interface IntegrationStatus {
  key: IntegrationKey;
  health: IntegrationHealth;
}

// 예상된 무효 저장값(SettingInvalidError)만 attention_required로 환원한다.
// 그 외 예외(DB 타임아웃·schema drift·reader 버그 등 인프라 장애)는 연동 key와 함께 로그하고
// unknown으로 구분 표시 — "설정 누락"과 "인프라 장애"를 섞어 운영자 신호를 잃지 않게 한다(적대적 리뷰 Finding 1).
async function safe(key: IntegrationKey, fn: () => Promise<boolean>): Promise<IntegrationHealth> {
  try {
    return (await fn()) ? "configured" : "attention_required";
  } catch (e) {
    if (e instanceof SettingInvalidError) return "attention_required";
    console.error(`[settings] integration status check failed for ${key}`, e);
    return "unknown";
  }
}

function secretOk(id: string, name: string, kind: "value" | "filePath"): boolean {
  return getSecretStatus([{ id, vars: [{ name, kind }] }])[0].health === "configured";
}

async function smtpConfigured(): Promise<boolean> {
  if (!secretOk("smtp", "SMTP_PASSWORD", "value")) return false;
  const host = await getSetting("integrations.smtp.host");
  const from = await getSetting("integrations.smtp.fromAddress");
  // port도 운영 필수값(fallbackSafe=false). 무효 row면 getSetting이 throw → safe()가 attention_required로 환원.
  const port = await getSetting("integrations.smtp.port");
  return (
    typeof host === "string" &&
    host.length > 0 &&
    typeof from === "string" &&
    from.length > 0 &&
    typeof port === "number"
  );
}

async function googleConfigured(): Promise<boolean> {
  if (!secretOk("google", "GOOGLE_APPLICATION_CREDENTIALS", "filePath")) return false;
  const ids = await getSetting("integrations.google.calendarIds");
  return Array.isArray(ids) && ids.length > 0;
}

function templatesConfigured(): boolean {
  return secretOk("templates", "LIBREOFFICE_PATH", "filePath");
}

// 연동별 view 권한 게이트 — listSettings 항목 필터와 동일 원칙(미보유 연동은 결과에서 제외).
// templates는 settings read가 없어(env secret만) throw하지 않으므로 unknown이 나올 수 없다.
const INTEGRATIONS: ReadonlyArray<{
  key: IntegrationKey;
  resource: string;
  check: () => Promise<IntegrationHealth> | IntegrationHealth;
}> = [
  { key: "smtp", resource: "integrations.smtp", check: () => safe("smtp", smtpConfigured) },
  { key: "google", resource: "integrations.google", check: () => safe("google", googleConfigured) },
  { key: "templates", resource: "integrations.templates", check: () => (templatesConfigured() ? "configured" : "attention_required") },
];

export async function getIntegrationStatuses(userId: string): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  for (const { key, resource, check } of INTEGRATIONS) {
    if (!(await hasPermission(userId, resource, "view"))) continue;
    out.push({ key, health: await check() });
  }
  return out;
}
