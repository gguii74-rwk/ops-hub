# Task 06 — modules/integrations 상태 모듈(read-only)

**Purpose:** 연동별 **coarse 상태 롤업**(`smtp`/`google`/`templates`)을 제공한다. secret 존재(`lib/env`) + 필수 systemSetting 완성도(`reader.getSetting`)를 결합한다. settings는 `kernel/settings/reader`(read-only)로만, 인가는 `kernel/access`의 `hasPermission`으로 접근하며 write 경로에 닿지 않는다(경계 seam 실증). 결과는 호출자(`userId`)가 `integrations.<key>:view`를 가진 연동만 포함한다 — `listSettings` 항목 필터와 동일 노출 원칙(Codex 2차 리뷰 F1).

## Files

- Create: `src/modules/integrations/status.ts` — `getIntegrationStatuses(userId)`(server-only).
- Create: `src/modules/integrations/index.ts` — 공개 facade.
- Test: `tests/modules/integrations/status.test.ts`.

## Prep

- spec §2.1·§6, entrypoint §SC-1(경계)·§SC-3(reader)·§SC-5(getSecretStatus).
- 경계: `modules/integrations` → `@/kernel/settings/reader` + `@/lib/env` + `@/kernel/access`(`hasPermission`). `service`/`index`/`catalog`·`setSetting` import 금지.

## Deps

- Task 02(`getSecretStatus`), Task 04(`reader`의 `getSetting`).

## TDD steps

### 1. 실패 테스트 작성 — `tests/modules/integrations/status.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const settings = new Map<string, unknown>();
let getSettingImpl: (k: string) => Promise<unknown>;
vi.mock("@/kernel/settings/reader", () => ({
  getSetting: (k: string) => getSettingImpl(k),
}));

let secretHealth: Record<string, "configured" | "attention_required">;
vi.mock("@/lib/env", () => ({
  getSecretStatus: (specs: Array<{ id: string }>) =>
    specs.map((s) => ({ id: s.id, health: secretHealth[s.id] ?? "attention_required" })),
}));

let allowed: Set<string>;
vi.mock("@/kernel/access", () => ({
  hasPermission: async (_u: string, resource: string, action: string) => allowed.has(`${resource}:${action}`),
}));

import { getIntegrationStatuses } from "@/modules/integrations";

beforeEach(() => {
  settings.clear();
  getSettingImpl = async (k) => {
    if (!settings.has(k)) throw new Error("unexpected key " + k);
    return settings.get(k);
  };
  secretHealth = { smtp: "attention_required", google: "attention_required", templates: "attention_required" };
  allowed = new Set(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]);
});

describe("getIntegrationStatuses", () => {
  it("secret 미설정이면 attention_required(설정값 조회 없이)", async () => {
    const out = await getIntegrationStatuses("u1");
    expect(out).toEqual([
      { key: "smtp", health: "attention_required" },
      { key: "google", health: "attention_required" },
      { key: "templates", health: "attention_required" },
    ]);
  });

  it("smtp: secret OK + host·from 채워짐 → configured", async () => {
    secretHealth.smtp = "configured";
    settings.set("integrations.smtp.host", "mail.x");
    settings.set("integrations.smtp.fromAddress", "ops@x.com");
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "smtp")!.health).toBe("configured");
  });

  it("smtp: secret OK지만 host 빈값 → attention_required", async () => {
    secretHealth.smtp = "configured";
    settings.set("integrations.smtp.host", "");
    settings.set("integrations.smtp.fromAddress", "ops@x.com");
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("google: secret OK + calendarIds 비어있음 → attention_required", async () => {
    secretHealth.google = "configured";
    settings.set("integrations.google.calendarIds", []);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });

  it("templates: secret OK → configured(설정값 불필요)", async () => {
    secretHealth.templates = "configured";
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "templates")!.health).toBe("configured");
  });

  it("getSetting이 throw(invalid 저장값)해도 크래시 없이 attention_required", async () => {
    secretHealth.smtp = "configured";
    getSettingImpl = async () => { throw new Error("SettingInvalidError"); };
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("integrations.<key>:view 없는 연동은 결과에서 제외", async () => {
    allowed = new Set(["integrations.smtp:view"]);
    const out = await getIntegrationStatuses("u1");
    expect(out.map((s) => s.key)).toEqual(["smtp"]);
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- integrations
```

기대: `Cannot find module '@/modules/integrations'`.

### 3. 구현 — `src/modules/integrations/status.ts`

```ts
import "server-only";
import { getSecretStatus } from "@/lib/env";
import { getSetting } from "@/kernel/settings/reader";
import { hasPermission } from "@/kernel/access";

export type IntegrationKey = "smtp" | "google" | "templates";
export type IntegrationHealth = "configured" | "attention_required";
export interface IntegrationStatus {
  key: IntegrationKey;
  health: IntegrationHealth;
}

async function safe(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false; // invalid 저장값 등으로 read가 throw해도 상태는 attention_required
  }
}

function secretOk(id: string, name: string, kind: "value" | "filePath"): boolean {
  return getSecretStatus([{ id, vars: [{ name, kind }] }])[0].health === "configured";
}

async function smtpConfigured(): Promise<boolean> {
  if (!secretOk("smtp", "SMTP_PASSWORD", "value")) return false;
  const host = await getSetting("integrations.smtp.host");
  const from = await getSetting("integrations.smtp.fromAddress");
  return typeof host === "string" && host.length > 0 && typeof from === "string" && from.length > 0;
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
const INTEGRATIONS: ReadonlyArray<{
  key: IntegrationKey;
  resource: string;
  check: () => Promise<boolean> | boolean;
}> = [
  { key: "smtp", resource: "integrations.smtp", check: () => safe(smtpConfigured) },
  { key: "google", resource: "integrations.google", check: () => safe(googleConfigured) },
  { key: "templates", resource: "integrations.templates", check: () => templatesConfigured() },
];

export async function getIntegrationStatuses(userId: string): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  for (const { key, resource, check } of INTEGRATIONS) {
    if (!(await hasPermission(userId, resource, "view"))) continue;
    const ok = await check();
    out.push({ key, health: ok ? "configured" : "attention_required" });
  }
  return out;
}
```

### 4. 구현 — `src/modules/integrations/index.ts`

```ts
import "server-only";
export { getIntegrationStatuses } from "./status";
export type { IntegrationStatus, IntegrationKey, IntegrationHealth } from "./status";
```

### 5. 실행 → PASS

```bash
npm test -- integrations
```

기대: 7 테스트 통과. 기존 Phase 1 federation 테스트(`tests/lib/auth/federation.test.ts`)는 영향 없음.

### 6. typecheck/lint

```bash
npm run typecheck && npm run lint
```

### 7. 커밋

```bash
git add src/modules/integrations/status.ts src/modules/integrations/index.ts tests/modules/integrations/status.test.ts
git commit -m "Add integrations status rollup (read-only via settings reader)"
```

## Acceptance Criteria

- `npm test -- integrations` → 7 PASS(연동별 view 게이트 포함).
- `npm run typecheck` / `npm run lint` → 에러 0(boundaries 위반 없음 — settings는 reader만, 인가는 kernel/access만).

## Cautions

- **`@/kernel/settings/service`·`index`·`catalog` import 금지. 이유:** 모듈은 read-only `reader`만(Codex Finding 11·경계 seam). write 경로 차단.
- **연동별 env 변수명은 이 모듈이 소유(secretOk 인자). 이유:** 연동 도메인 지식은 kernel 카탈로그가 아니라 integrations 모듈에 둔다(kernel cross-domain 적재 완화).
- **getSetting throw를 삼키되 silent로 두지 말 것 — `attention_required`로 환원. 이유:** invalid 저장값(fallbackSafe=false)이 상태 화면을 깨지 않게 하되, "정상"으로 오인되지 않게 한다.
- **인가는 `@/kernel/access`의 `hasPermission`만(연동별 view 게이트), `catalog`/`getEntry`로 권한을 끌어오지 말 것. 이유:** 연동 상태도 항목별 권한 필터 대상(Codex 2차 리뷰 F1). 경계 가드(task-09)는 `@/kernel/settings/*`만 제한하므로 `kernel/access` import는 허용되지만 settings는 여전히 reader로만.
