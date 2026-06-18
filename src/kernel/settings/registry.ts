import type { ZodTypeAny } from "zod";
import type { Action } from "@/kernel/access";
import type { Prisma } from "@prisma/client";

export type JsonValue = Prisma.InputJsonValue;
export type SettingCategory = "security" | "integrations" | "workflows" | "general";
export type AuditMode = "full" | "redacted" | "summary";
export type SettingStatus = "OK" | "INVALID" | "configured" | "attention_required" | "LINK";

interface SettingEntryBase {
  key: string;
  category: SettingCategory;
  order: number;
  title: string;
  description: string;
  permission: { resource: string; action: Action };
}
export interface SystemSettingEntry extends SettingEntryBase {
  kind: "systemSetting";
  schema: ZodTypeAny;
  default: JsonValue;
  audit: AuditMode;
  fallbackSafe: boolean;
}
export interface RelationalSettingEntry extends SettingEntryBase {
  kind: "relational";
  model: string;
  manageHref: string;
}
export interface EnvSecretEntry extends SettingEntryBase {
  kind: "envSecret";
  // aliases: 같은 secret을 받는 대체 env 이름(예: NEXTAUTH_SECRET ↔ AUTH_SECRET). 하나라도 present면 충족.
  envVars: Array<{ name: string; kind: "value" | "filePath"; aliases?: string[] }>;
}
export type SettingEntry = SystemSettingEntry | RelationalSettingEntry | EnvSecretEntry;

export class UnknownSettingError extends Error {
  constructor(key: string) {
    super(`Unknown setting key: ${key}`);
    this.name = "UnknownSettingError";
  }
}
export class SettingNotWritableError extends Error {
  constructor(key: string) {
    super(`Setting is not writable: ${key}`);
    this.name = "SettingNotWritableError";
  }
}
export class SettingValidationError extends Error {
  constructor(key: string, detail: string) {
    super(`Setting validation failed for ${key}: ${detail}`);
    this.name = "SettingValidationError";
  }
}
export class SettingConcurrencyError extends Error {
  constructor(key: string) {
    super(`Setting was modified concurrently: ${key}`);
    this.name = "SettingConcurrencyError";
  }
}
export class SettingInvalidError extends Error {
  constructor(key: string) {
    super(`Stored setting value is invalid and not fallback-safe: ${key}`);
    this.name = "SettingInvalidError";
  }
}
export class SettingActorRequiredError extends Error {
  constructor() {
    super("settings write requires a non-null actorId");
    this.name = "SettingActorRequiredError";
  }
}
