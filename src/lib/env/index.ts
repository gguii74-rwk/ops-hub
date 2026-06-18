import "server-only";
import { existsSync } from "node:fs";
import { envSchema, type Env } from "./schema";

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // refine 이슈는 path가 비어 있으므로 message로 폴백(예: "NEXTAUTH_SECRET or AUTH_SECRET is required").
    const detail = result.error.issues.map((i) => i.path.join(".") || i.message).join(", ");
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  return result.data;
}

export const env: Env = parseEnv();

export type SecretHealth = "configured" | "attention_required";
export type SecretVar = { name: string; kind: "value" | "filePath"; aliases?: string[] };
export interface SecretStatus {
  id: string;
  health: SecretHealth;
}

function probeVar(v: SecretVar): boolean {
  // name + aliases 중 하나라도 present면 충족(예: NEXTAUTH_SECRET 또는 AUTH_SECRET).
  const candidates = [v.name, ...(v.aliases ?? [])];
  const raw = candidates.map((n) => process.env[n]).find((val) => val !== undefined && val.trim() !== "");
  if (!raw) return false;
  if (v.kind === "filePath") return existsSync(raw);
  return true;
}

export function getSecretStatus(specs: Array<{ id: string; vars: SecretVar[] }>): SecretStatus[] {
  return specs.map((spec) => ({
    id: spec.id,
    health: spec.vars.every(probeVar) ? "configured" : "attention_required",
  }));
}
