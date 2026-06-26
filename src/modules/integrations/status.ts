import "server-only";
import { getSecretStatus } from "@/lib/env";
import { getSetting, getSmtpConfig, SettingInvalidError } from "@/kernel/settings/reader";
import { hasPermission } from "@/kernel/access";

export type IntegrationKey = "smtp" | "google" | "templates";
export type IntegrationHealth = "configured" | "attention_required" | "unknown";
export interface IntegrationStatus {
  key: IntegrationKey;
  health: IntegrationHealth;
}

// 예상된 무효 저장값(SettingInvalidError)만 attention_required로 환원. 그 외 예외(DB 장애·schema drift 등)는
// 연동 key와 함께 로그하고 unknown으로 구분 표시 — "설정 누락"과 "인프라 장애"를 섞지 않는다.
// (google 경로 전용 — smtp는 getSmtpConfig가 tolerant(throw 없음, D10)라 safe 래핑 불필요.)
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

// SMTP 상태(D5·F9): 전송 auth 분기(SMTP_USER ? {user,pass} : undefined)와 정확히 일치.
// host(env) 존재 + 인증 정합성(user 없으면 무인증 릴레이로 OK, user 있으면 비밀번호도 필요).
// host/user는 env(D2)에서 오므로 "env에 발송 가능한 SMTP가 있으면 정상" = 실제 발송 가능 여부와 일치.
async function smtpConfigured(): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (cfg.host.length === 0) return false;
  if (cfg.user.length === 0) return true; // 무인증 릴레이
  return secretOk("smtp", "SMTP_PASSWORD", "value"); // 인증 모드 → 비밀번호 필요
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
// smtp: getSmtpConfig가 throw하지 않으므로(D10) safe 래핑 없이 직접 — unknown 미발생.
// google: prisma/getSetting이 throw할 수 있어 safe()/unknown 3-state 유지.
// templates: settings read 없음(env secret만) → throw 불가.
const INTEGRATIONS: ReadonlyArray<{
  key: IntegrationKey;
  resource: string;
  check: () => Promise<IntegrationHealth> | IntegrationHealth;
}> = [
  { key: "smtp", resource: "integrations.smtp", check: async () => ((await smtpConfigured()) ? "configured" : "attention_required") },
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
