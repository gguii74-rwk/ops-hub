import "server-only";
import type { Prisma } from "@prisma/client";
import type { MailTransportConfig } from "@/lib/integrations/mail";
import { hasPermission, requirePermission } from "@/kernel/access";
import { getSecretStatus } from "@/lib/env";
import { CATALOG, getEntry } from "./catalog";
import { readRaw, writeWithAudit } from "./repository";
import {
  SettingActorRequiredError,
  SettingInvalidError,
  SettingNotWritableError,
  SettingValidationError,
  UnknownSettingError,
} from "./registry";
import type {
  AuditMode,
  EnvSecretEntry,
  SettingCategory,
  SettingEntry,
  SettingGroup,
  SettingStatus,
} from "./registry";

export interface SettingsCatalogItem {
  key: string;
  kind: SettingEntry["kind"];
  category: SettingCategory;
  group: SettingGroup;
  groupOrder: number;
  order: number;
  title: string;
  description: string;
  status: SettingStatus;
  manageHref?: string;
  value?: unknown;
  updatedAt?: Date;
}

export interface SetSettingCtx {
  actorId: string;
  // 필수: null=최초 생성, Date=낙관적 잠금. 생략(undefined)을 허용하면 repository의
  // last-write-wins upsert로 떨어져 호출자가 토큰을 잊는 것만으로 동시성 가드를 조용히
  // 우회할 수 있으므로 필수로 둔다(컴파일 타임 차단).
  expectedUpdatedAt: Date | null;
}

// --- READ(운영) ---
export async function getSetting(key: string): Promise<unknown> {
  const e = getEntry(key);
  if (!e || e.kind !== "systemSetting") throw new UnknownSettingError(key);
  const row = await readRaw(key);
  if (!row) return e.default;
  const parsed = e.schema.safeParse(row.value);
  if (parsed.success) return parsed.data;
  if (e.fallbackSafe) {
    console.warn(`[settings] invalid stored value for ${key}; using default`);
    return e.default;
  }
  throw new SettingInvalidError(key);
}

// --- SMTP 전송 config 해석기(D1·D2·D10, F2·P1) ---
// host/user/secure/port는 env 전용(D2·F4·P3/A2 — host: 전역 env 비밀번호 유출 벡터 차단; port: TLS 모드 secure와
// 결합돼 있어 함께 env 한 곳에서 관리, DB 편집 시 드리프트). from만 DB 편집(readRaw).
// 절대 throw하지 않는다(D10·F2): DB 읽기/파싱 실패도 env 폴백 + console.warn만. 두 mail 호출자가 무조건 await하므로
// 여기서 throw하면 env가 멀쩡해도 발송이 막힌다. 깨진 from 행은 listSettings 항목별 INVALID 배지로 별도 노출(신호 보존).
export async function getSmtpConfig(): Promise<MailTransportConfig> {
  const host = process.env.SMTP_HOST ?? "";
  const user = process.env.SMTP_USER ?? "";
  const secure = process.env.SMTP_SECURE === "true";

  // port는 env 전용(P3/A2) — DB row 미읽음(있어도 orphan으로 무시).
  // 빈 문자열/0/범위 밖/비정수는 587(P5: Number("")===0·Number(" ")===0이 finite라 NaN 가드를 통과해 port 0이 되는 함정 회피).
  const portRaw = (process.env.SMTP_PORT ?? "").trim();
  const portNum = Number(portRaw);
  const port = portRaw !== "" && Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 ? portNum : 587;

  let from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@uracle.co.kr";
  try {
    const row = await readRaw("integrations.smtp.fromAddress");
    if (row && typeof row.value === "string" && row.value.length > 0) {
      // 카탈로그 schema(email-or-empty)와 동일 규칙으로 검증(F7과 같은 정신, P1): 비어있지 않은 무효값
      // (예: "not-an-email")은 env로 폴백한다 — 무효 행이 유효 env SMTP_FROM을 덮어 발송을 깨면 안 됨(D10).
      // 깨진 행 자체는 listSettings의 항목별 INVALID 배지로 별도 노출(신호 보존).
      const entry = getEntry("integrations.smtp.fromAddress");
      const valid = entry?.kind === "systemSetting" && entry.schema.safeParse(row.value).success;
      if (valid) from = row.value;
      else console.warn("[settings] invalid integrations.smtp.fromAddress row; using env");
    }
  } catch (e) {
    console.warn("[settings] failed reading integrations.smtp.fromAddress; using env", e);
  }

  return { host, port, secure, user, from };
}

// --- WRITE(fail-closed) ---
// 권한 게이트(admin.settings:configure + 항목 권한)는 라우트 층에서 강제한다(열거 방지를
// 위해 base 게이트를 getEntry보다 먼저 검사 — route.ts 참조). 이 프리미티브를 직접 호출하는
// 신규 server-side 호출자는 동일 게이트를 복제해야 한다.
export async function setSetting(key: string, value: unknown, ctx: SetSettingCtx): Promise<{ updatedAt: Date }> {
  if (!ctx.actorId || ctx.actorId.trim() === "") throw new SettingActorRequiredError();
  const e = getEntry(key);
  if (!e) throw new UnknownSettingError(key);
  if (e.kind !== "systemSetting") throw new SettingNotWritableError(key);
  const parsed = e.schema.safeParse(value);
  if (!parsed.success) throw new SettingValidationError(key, parsed.error.message);
  return writeWithAudit({
    key,
    value: parsed.data as Prisma.InputJsonValue,
    expectedUpdatedAt: ctx.expectedUpdatedAt,
    actorId: ctx.actorId,
    redact: (before, after) => redactForAudit(e.audit, before, after),
  });
}

// --- UI 목록(admin 게이트 + 항목 인가 + 상태) ---
export async function listSettings(userId: string): Promise<SettingsCatalogItem[]> {
  await requirePermission(userId, "admin.settings", "view");

  const secretSpecs = CATALOG.filter((e): e is EnvSecretEntry => e.kind === "envSecret").map((e) => ({
    id: e.key,
    vars: e.envVars,
  }));
  const secretHealth = new Map(getSecretStatus(secretSpecs).map((s) => [s.id, s.health]));

  const items: SettingsCatalogItem[] = [];
  for (const e of CATALOG) {
    if (!(await hasPermission(userId, e.permission.resource, e.permission.action))) continue;
    const base = {
      key: e.key,
      kind: e.kind,
      category: e.category,
      group: e.group,
      groupOrder: e.groupOrder,
      order: e.order,
      title: e.title,
      description: e.description,
    };
    if (e.kind === "systemSetting") {
      const row = await readRaw(e.key);
      if (!row) {
        items.push({ ...base, status: "OK", value: e.default });
      } else {
        const parsed = e.schema.safeParse(row.value);
        items.push({
          ...base,
          status: parsed.success ? "OK" : "INVALID",
          value: parsed.success ? parsed.data : e.default,
          updatedAt: row.updatedAt,
        });
      }
    } else if (e.kind === "envSecret") {
      let status: SettingStatus = secretHealth.get(e.key) ?? "attention_required";
      // F12: secret.smtp 행 상태를 전송 auth 분기와 일치. SMTP_USER 미설정(무인증 릴레이)이면
      // 비밀번호 불필요 → not_required(중립). 그룹 헤더(smtpConfigured)와 어긋나지 않게 한다.
      if (e.key === "secret.smtp" && (process.env.SMTP_USER ?? "").length === 0) {
        status = "not_required";
      }
      items.push({ ...base, status });
    } else {
      items.push({ ...base, status: "LINK", manageHref: e.manageHref });
    }
  }
  items.sort((a, b) => a.order - b.order);
  return items;
}

// --- audit redaction ---
function summarize(v: unknown): Prisma.InputJsonValue {
  if (Array.isArray(v)) {
    return { type: "array", length: v.length };
  }
  if (v !== null && typeof v === "object") {
    return { type: "object", keys: Object.keys(v as object).sort() };
  }
  return { type: typeof v };
}
export function redactForAudit(mode: AuditMode, before: unknown, after: unknown): Prisma.InputJsonValue {
  if (mode === "full") return { before: (before ?? null) as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue };
  if (mode === "redacted") return { changed: true };
  // summary: 구조 요약 + 변경여부만. 원 PII·역추적 해시 미저장(원값은 비교용으로만 전개, 저장 안 함).
  return {
    before: summarize(before),
    after: summarize(after),
    changed: JSON.stringify(before) !== JSON.stringify(after),
  };
}
