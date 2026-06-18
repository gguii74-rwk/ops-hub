import "server-only";
import type { Prisma } from "@prisma/client";
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
  SettingStatus,
} from "./registry";

export interface SettingsCatalogItem {
  key: string;
  kind: SettingEntry["kind"];
  category: SettingCategory;
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
  expectedUpdatedAt?: Date | null;
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

// --- WRITE(fail-closed) ---
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
      items.push({ ...base, status: secretHealth.get(e.key) ?? "attention_required" });
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
