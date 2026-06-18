# Task 04 — service + reader + index: getSetting/setSetting/listSettings + redaction

**Purpose:** registry의 동작 계층. 운영 read(`getSetting`, fallbackSafe), fail-closed write(`setSetting`, allowlist·Zod·audit·concurrency·actorId), admin 게이트 + 항목별 인가 + 상태 merge(`listSettings`), PII redaction을 구현한다.

## Files

> registry.ts는 수정하지 않는다. `SettingsCatalogItem` DTO는 service.ts에 정의하고 index.ts가 타입 재노출한다.

- Create: `src/kernel/settings/service.ts` — getSetting/setSetting/listSettings/redactForAudit(entrypoint §SC-3·§SC-6).
- Create: `src/kernel/settings/reader.ts` — 모듈용 read-only facade.
- Create: `src/kernel/settings/index.ts` — app facade.
- Test: `tests/kernel/settings/service.test.ts`.

## Prep

- spec §5.1·§5.2·§5.4·§5.5·§5.6·§5.8, entrypoint §SC-3·§SC-4·§SC-6·§SC-7.
- 의존: Task 01(catalog/registry), Task 02(`getSecretStatus`), Task 03(repository). 인가는 Phase 1 `@/kernel/access`의 `hasPermission`/`requirePermission`.

## Deps

- Task 01, 02, 03.

## TDD steps

### 1. 실패 테스트 작성 — `tests/kernel/settings/service.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// --- mock repository ---
const store = new Map<string, { value: unknown; updatedAt: Date }>();
const writeCalls: any[] = [];
vi.mock("@/kernel/settings/repository", () => ({
  readRaw: async (key: string) => store.get(key) ?? null,
  writeWithAudit: async (p: any) => {
    writeCalls.push(p);
    const updatedAt = new Date(2026, 0, 2);
    store.set(p.key, { value: p.value, updatedAt });
    // redact를 실제로 호출해 metadata 형태 검증 가능하게 한다
    p._auditMetadata = p.redact(store.get(p.key)?.value, p.value);
    return { updatedAt };
  },
}));

// --- mock access ---
class FakeForbidden extends Error {}
let allowed = new Set<string>();
let baseAllowed = true;
vi.mock("@/kernel/access", () => ({
  ForbiddenError: FakeForbidden,
  requirePermission: async (_u: string, resource: string, action: string) => {
    if (resource === "admin.settings" && action === "view" && !baseAllowed) throw new FakeForbidden();
  },
  hasPermission: async (_u: string, resource: string, action: string) => allowed.has(`${resource}:${action}`),
}));

// --- mock env ---
vi.mock("@/lib/env", () => ({
  getSecretStatus: (specs: Array<{ id: string }>) =>
    specs.map((s) => ({ id: s.id, health: s.id === "secret.smtp" ? "configured" : "attention_required" })),
}));

import {
  getSetting,
  setSetting,
  listSettings,
  redactForAudit,
} from "@/kernel/settings/service";
import {
  UnknownSettingError,
  SettingNotWritableError,
  SettingValidationError,
  SettingInvalidError,
  SettingActorRequiredError,
} from "@/kernel/settings/registry";

beforeEach(() => {
  store.clear();
  writeCalls.length = 0;
  allowed = new Set();
  baseAllowed = true;
});

describe("getSetting", () => {
  it("미등록 key → UnknownSettingError", async () => {
    await expect(getSetting("nope.nope.nope")).rejects.toBeInstanceOf(UnknownSettingError);
  });
  it("row 없음 → default", async () => {
    expect(await getSetting("integrations.smtp.port")).toBe(587);
  });
  it("유효 row → 값", async () => {
    store.set("integrations.smtp.host", { value: "mail.x", updatedAt: new Date() });
    expect(await getSetting("integrations.smtp.host")).toBe("mail.x");
  });
  it("invalid row + fallbackSafe=true → default(no throw)", async () => {
    store.set("workflows.weeklyReport.defaultRecipients", { value: "not-array", updatedAt: new Date() });
    expect(await getSetting("workflows.weeklyReport.defaultRecipients")).toEqual([]);
  });
  it("invalid row + fallbackSafe=false → SettingInvalidError", async () => {
    store.set("integrations.smtp.host", { value: 123, updatedAt: new Date() });
    await expect(getSetting("integrations.smtp.host")).rejects.toBeInstanceOf(SettingInvalidError);
  });
});

describe("setSetting", () => {
  it("actorId 누락 → SettingActorRequiredError", async () => {
    await expect(setSetting("integrations.smtp.host", "x", { actorId: "" })).rejects.toBeInstanceOf(SettingActorRequiredError);
  });
  it("미등록 key → UnknownSettingError", async () => {
    await expect(setSetting("nope.nope.nope", "x", { actorId: "u1" })).rejects.toBeInstanceOf(UnknownSettingError);
  });
  it("envSecret key → SettingNotWritableError", async () => {
    await expect(setSetting("secret.smtp", "x", { actorId: "u1" })).rejects.toBeInstanceOf(SettingNotWritableError);
  });
  it("relational key → SettingNotWritableError", async () => {
    await expect(setSetting("workflows.billing.config", {}, { actorId: "u1" })).rejects.toBeInstanceOf(SettingNotWritableError);
  });
  it("Zod 실패 → SettingValidationError", async () => {
    await expect(setSetting("integrations.smtp.fromAddress", "not-email", { actorId: "u1" })).rejects.toBeInstanceOf(SettingValidationError);
  });
  it("성공 → writeWithAudit 호출(검증된 값·actorId·expectedUpdatedAt·redact 전달)", async () => {
    const at = new Date(2026, 0, 1);
    await setSetting("integrations.smtp.port", "590", { actorId: "u1", expectedUpdatedAt: at });
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({ key: "integrations.smtp.port", value: 590, actorId: "u1", expectedUpdatedAt: at });
    expect(typeof writeCalls[0].redact).toBe("function");
  });
});

describe("redactForAudit", () => {
  it("full → before/after 원값", () => {
    expect(redactForAudit("full", "a", "b")).toEqual({ before: "a", after: "b" });
  });
  it("redacted → 값 없음", () => {
    expect(redactForAudit("redacted", "a", "b")).toEqual({ changed: true });
  });
  it("summary 배열 → 원 PII 부재(길이+changed, 역추적 해시 없음)", () => {
    const out: any = redactForAudit("summary", ["a@x.com"], ["a@x.com", "b@y.com"]);
    expect(JSON.stringify(out)).not.toContain("@x.com");
    expect(out.before).toMatchObject({ type: "array", length: 1 });
    expect(out.after).toMatchObject({ type: "array", length: 2 });
    expect(out.changed).toBe(true);
    expect("hash" in out.after).toBe(false);
  });
  it("summary 동일값 재저장 → changed=false", () => {
    expect(redactForAudit("summary", ["a@x.com"], ["a@x.com"])).toMatchObject({ changed: false });
  });
});

describe("listSettings", () => {
  it("admin.settings:view 없으면 base 게이트 throw", async () => {
    baseAllowed = false;
    await expect(listSettings("u1")).rejects.toBeInstanceOf(FakeForbidden);
  });
  it("권한 있는 항목만 포함(hasPermission 기준)", async () => {
    allowed = new Set(["integrations.smtp:configure"]);
    const items = await listSettings("u1");
    const keys = items.map((i) => i.key);
    expect(keys).toContain("integrations.smtp.host");
    expect(keys).not.toContain("workflows.weeklyReport.defaultRecipients");
  });
  it("systemSetting status: 유효→OK(value), invalid→INVALID(default)", async () => {
    allowed = new Set(["integrations.smtp:configure"]);
    store.set("integrations.smtp.host", { value: 123, updatedAt: new Date() }); // invalid
    const items = await listSettings("u1");
    const host = items.find((i) => i.key === "integrations.smtp.host")!;
    expect(host.status).toBe("INVALID");
    expect(host.value).toBe(""); // default
  });
  it("envSecret status=coarse, value 없음", async () => {
    allowed = new Set(["integrations.smtp:view"]);
    const items = await listSettings("u1");
    const smtp = items.find((i) => i.key === "secret.smtp")!;
    expect(smtp.status).toBe("configured");
    expect("value" in smtp).toBe(false);
  });
  it("relational status=LINK + manageHref", async () => {
    allowed = new Set(["workflows.billing:configure"]);
    const items = await listSettings("u1");
    const billing = items.find((i) => i.key === "workflows.billing.config")!;
    expect(billing.status).toBe("LINK");
    expect(billing.manageHref).toBe("/admin/settings/billing");
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- service
```

기대: `Cannot find module '@/kernel/settings/service'`.

### 3. 구현 — `src/kernel/settings/service.ts`

```ts
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
```

### 4. 구현 — `src/kernel/settings/reader.ts`

```ts
import "server-only";
// 모듈 전용 read-only facade. setSetting/listSettings 미노출.
export { getSetting } from "./service";
```

### 5. 구현 — `src/kernel/settings/index.ts`

```ts
import "server-only";
export { getSetting, setSetting, listSettings, redactForAudit } from "./service";
export type { SettingsCatalogItem, SetSettingCtx } from "./service";
```

### 6. 실행 → PASS

```bash
npm test -- service
```

기대: getSetting 5 + setSetting 6 + redactForAudit 4 + listSettings 6 = 21 테스트 통과.

### 7. typecheck/lint

```bash
npm run typecheck && npm run lint
```

### 8. 커밋

```bash
git add src/kernel/settings/service.ts src/kernel/settings/reader.ts src/kernel/settings/index.ts tests/kernel/settings/service.test.ts
git commit -m "Add settings service: getSetting/setSetting/listSettings with redaction and gates"
```

## Acceptance Criteria

- `npm test -- service` → 21 PASS.
- `npm run typecheck` / `npm run lint` → 에러 0.
- `listSettings`는 `admin.settings:view` 없으면 ForbiddenError, 항목은 `hasPermission`로 필터, secret 항목에 `value` 키 부재.
- `setSetting`은 systemSetting 키만 허용(envSecret/relational→`SettingNotWritableError`, 미등록→`UnknownSettingError`).

## Cautions

- **`listSettings` 항목 인가는 `hasPermission`로. `getPermissionSummary` 쓰지 말 것. 이유:** summary는 scope/condition 미인지 UI 최적화라 인가 판단에 부적합(Codex Finding 10).
- **`listSettings` 응답에 secret 값을 절대 싣지 말 것. 이유:** envSecret 항목은 `value` 없이 coarse status만(Codex Finding 2·4).
- **`getSetting`은 systemSetting 키 전용(그 외 throw). 이유:** secret은 `lib/env`, relational은 도메인 service가 읽는다. reader로 secret/relational 값을 읽으려는 시도는 버그.
- **summary redaction에 원값·역추적 해시를 넣지 말 것. 이유:** 수신자·캘린더ID는 이메일 PII(Codex Finding 7). 결정적 해시(sha256 prefix)는 동일 셋을 이력 간 상관·사전공격으로 확정 가능 → 길이+`changed`만(Codex 2차 리뷰 F2). 테스트가 원 PII·해시 부재를 강제.
- **`index.ts`는 `reader`를 re-export하지 말 것. 이유:** 모듈이 index를 통해 우회 import하면 read-only 격리가 깨진다(가드는 task-09).
