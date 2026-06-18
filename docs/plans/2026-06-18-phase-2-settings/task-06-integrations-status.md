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
vi.mock("@/kernel/settings/reader", () => {
  // SettingInvalidError는 factory 내부에 정의(hoist TDZ 회피). status.ts가 같은 모듈에서
  // import하므로 동일 클래스를 공유 → instanceof 구분이 성립한다.
  class SettingInvalidError extends Error {}
  return {
    getSetting: (k: string) => getSettingImpl(k),
    SettingInvalidError,
  };
});

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
import { SettingInvalidError } from "@/kernel/settings/reader";

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

  it("smtp: secret OK + host·from·port 채워짐 → configured", async () => {
    secretHealth.smtp = "configured";
    settings.set("integrations.smtp.host", "mail.x");
    settings.set("integrations.smtp.fromAddress", "ops@x.com");
    settings.set("integrations.smtp.port", 587);
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "smtp")!.health).toBe("configured");
  });

  it("smtp: secret OK지만 host 빈값 → attention_required", async () => {
    secretHealth.smtp = "configured";
    settings.set("integrations.smtp.host", "");
    settings.set("integrations.smtp.fromAddress", "ops@x.com");
    settings.set("integrations.smtp.port", 587);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("smtp: secret·host·from OK지만 port 무효(getSetting이 SettingInvalidError throw) → attention_required", async () => {
    secretHealth.smtp = "configured";
    settings.set("integrations.smtp.host", "mail.x");
    settings.set("integrations.smtp.fromAddress", "ops@x.com");
    settings.set("integrations.smtp.port", 587);
    const map = getSettingImpl;
    getSettingImpl = async (k) =>
      k === "integrations.smtp.port" ? Promise.reject(new SettingInvalidError()) : map(k);
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

  it("getSetting이 SettingInvalidError throw(invalid 저장값)해도 크래시 없이 attention_required", async () => {
    secretHealth.smtp = "configured";
    getSettingImpl = async () => { throw new SettingInvalidError(); };
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("getSetting이 예상 못한 에러(DB 장애 등) throw → unknown(설정 누락과 구분, 로그)", async () => {
    secretHealth.smtp = "configured";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getSettingImpl = async () => { throw new Error("ECONNREFUSED"); };
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "smtp")!.health).toBe("unknown");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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

기대: 9 테스트 통과. 기존 Phase 1 federation 테스트(`tests/lib/auth/federation.test.ts`)는 영향 없음.

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

- `npm test -- integrations` → 9 PASS(연동별 view 게이트 + SMTP port 검증 + 예상 못한 에러 → unknown 포함).
- `npm run typecheck` / `npm run lint` → 에러 0(boundaries 위반 없음 — settings는 reader만, 인가는 kernel/access만).

## Cautions

- **`@/kernel/settings/service`·`index`·`catalog` import 금지. 이유:** 모듈은 read-only `reader`만(Codex Finding 11·경계 seam). write 경로 차단.
- **연동별 env 변수명은 이 모듈이 소유(secretOk 인자). 이유:** 연동 도메인 지식은 kernel 카탈로그가 아니라 integrations 모듈에 둔다(kernel cross-domain 적재 완화).
- **getSetting throw를 무차별 삼키지 말 것 — `SettingInvalidError`만 `attention_required`로 환원하고, 그 외 예외는 로그 + `unknown`으로 구분. 이유:** 적대적 리뷰 Finding 1 — `catch {}`로 모든 예외를 `false`(설정 누락)로 뭉치면 DB 타임아웃·schema drift 같은 인프라 장애가 "설정이 비었다"로 위장돼 운영자가 복구 신호를 잃는다. 무효 저장값(fallbackSafe=false)은 예상된 상황이라 `attention_required`로 두되, 예상 못한 장애는 `unknown`으로 분리하고 연동 key와 함께 로그한다(silent 금지).
- **SMTP 완성도는 host·fromAddress뿐 아니라 `integrations.smtp.port`까지 확인. 이유:** Codex 3차 F6 — port도 운영 필수값(fallbackSafe=false)이라, 무효 port row가 있으면 실제 발송은 깨지는데 상태만 "정상"으로 표시되는 괴리를 막는다. port를 읽으면 무효 시 getSetting이 throw→`safe()`가 attention_required로 환원한다.
- **인가는 `@/kernel/access`의 `hasPermission`만(연동별 view 게이트), `catalog`/`getEntry`로 권한을 끌어오지 말 것. 이유:** 연동 상태도 항목별 권한 필터 대상(Codex 2차 리뷰 F1). 경계 가드(task-09)는 `@/kernel/settings/*`만 제한하므로 `kernel/access` import는 허용되지만 settings는 여전히 reader로만.
