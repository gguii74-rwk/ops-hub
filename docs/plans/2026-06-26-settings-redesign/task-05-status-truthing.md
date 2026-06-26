# Task 05 — 상태 진실화: `smtpConfigured` auth 분기 + `secret.smtp` 행 상태(F12)

**Purpose**: SMTP 연동 상태를 전송 auth 분기와 일치시킨다(D5·F9) — host(env)+인증 정합성. `getSmtpConfig`가 tolerant라 smtp는 `safe()`/`unknown` 미사용. 또한 `secret.smtp`(비밀번호) 항목 행 상태도 auth 분기를 따라(F12) 무인증 릴레이 시 `"not_required"`(중립)로 표시해 그룹 헤더와 어긋나지 않게 한다.

## Files

- Modify `src/kernel/settings/registry.ts` — `SettingStatus`에 `"not_required"` 추가.
- Modify `src/kernel/settings/service.ts` — `listSettings`의 `secret.smtp` 행 상태(F12).
- Modify `src/modules/integrations/status.ts` — `smtpConfigured` auth 분기 + smtp `safe` 제거.
- Rewrite `tests/modules/integrations/status.test.ts` — auth 분기 케이스로 재작성.
- Modify `tests/kernel/settings/service.test.ts` — `secret.smtp` 행 상태(F12) 테스트.

## Prep

- 엔트리포인트 §Shared Contracts SC-2(`getSmtpConfig`), SC-5(`not_required`), SC-6(`smtpConfigured` 규칙).
- spec §5.3, F9·F12.
- **Deps: task-03**(`getSmtpConfig` 존재). (registry는 task-01이 group으로 한 번 편집 — 여기서 다른 줄 추가.)

## TDD steps

### Step 1 — registry.ts: `SettingStatus`에 `not_required`

`src/kernel/settings/registry.ts`의 `SettingStatus`:
```ts
export type SettingStatus = "OK" | "INVALID" | "configured" | "attention_required" | "LINK" | "not_required";
```

### Step 2 — status 테스트 재작성(FAIL 유도)

`tests/modules/integrations/status.test.ts`를 아래 전체 내용으로 교체한다(smtp는 getSmtpConfig 기반 auth 분기, google은 현행 safe/unknown 유지):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getSmtpCfg, setSmtpCfg, getCalendarIds, setCalendarIds, getCalendarThrows, setCalendarThrows,
  getSecretHealth, setSecretHealth, getAllowed, setAllowed,
} = vi.hoisted(() => {
  let smtpCfg = { host: "", port: 587, secure: false, user: "", from: "" };
  let calendarIds: unknown = [];
  let calendarThrows: null | "invalid" | "infra" = null;
  let secretHealth: Record<string, "configured" | "attention_required"> = {
    smtp: "attention_required", google: "attention_required", templates: "attention_required",
  };
  let allowed = new Set<string>(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]);
  return {
    getSmtpCfg: () => smtpCfg, setSmtpCfg: (c: typeof smtpCfg) => { smtpCfg = c; },
    getCalendarIds: () => calendarIds, setCalendarIds: (v: unknown) => { calendarIds = v; },
    getCalendarThrows: () => calendarThrows, setCalendarThrows: (v: null | "invalid" | "infra") => { calendarThrows = v; },
    getSecretHealth: () => secretHealth, setSecretHealth: (h: typeof secretHealth) => { secretHealth = h; },
    getAllowed: () => allowed, setAllowed: (s: Set<string>) => { allowed = s; },
  };
});

vi.mock("@/kernel/settings/reader", () => {
  class SettingInvalidError extends Error {}
  return {
    getSmtpConfig: async () => getSmtpCfg(),
    getSetting: async (k: string) => {
      if (k === "integrations.google.calendarIds") {
        if (getCalendarThrows() === "invalid") throw new SettingInvalidError(k);
        if (getCalendarThrows() === "infra") throw new Error("ECONNREFUSED");
        return getCalendarIds();
      }
      throw new Error("unexpected key " + k);
    },
    SettingInvalidError,
  };
});

vi.mock("@/lib/env", () => ({
  getSecretStatus: (specs: Array<{ id: string }>) =>
    specs.map((s) => ({ id: s.id, health: getSecretHealth()[s.id] ?? "attention_required" })),
}));

vi.mock("@/kernel/access", () => ({
  hasPermission: async (_u: string, resource: string, action: string) => getAllowed().has(`${resource}:${action}`),
}));

import { getIntegrationStatuses } from "@/modules/integrations";

const smtpHealth = (out: { key: string; health: string }[]) => out.find((s) => s.key === "smtp")!.health;

beforeEach(() => {
  setSmtpCfg({ host: "", port: 587, secure: false, user: "", from: "" });
  setCalendarIds([]);
  setCalendarThrows(null);
  setSecretHealth({ smtp: "attention_required", google: "attention_required", templates: "attention_required" });
  setAllowed(new Set(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]));
});

describe("smtpConfigured — 전송 auth 분기 일치(D5·F9)", () => {
  it("① host + SMTP_USER + SMTP_PASSWORD → configured", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "bob", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("configured");
  });
  it("② host + SMTP_USER 없음(무인증 릴레이) → configured(비밀번호 무관)", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "attention_required" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("configured");
  });
  it("③ host + SMTP_USER 있는데 SMTP_PASSWORD 없음 → attention_required", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "bob", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "attention_required" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("attention_required");
  });
  it("④ host 없음 → attention_required(user/password 무관)", async () => {
    setSmtpCfg({ host: "", port: 587, secure: false, user: "bob", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("attention_required");
  });
  it("smtp는 unknown이 나오지 않는다(getSmtpConfig tolerant → safe 미사용)", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "", from: "" });
    expect(["configured", "attention_required"]).toContain(smtpHealth(await getIntegrationStatuses("u1")));
  });
});

describe("googleConfigured (현행 유지) + safe 3-state", () => {
  it("secret OK + calendarIds 있음 → configured", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    setCalendarIds(["cal-1"]);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("configured");
  });
  it("secret OK + calendarIds 비어있음 → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    setCalendarIds([]);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });
  it("secret 미설정 → attention_required(설정값 조회 없이)", async () => {
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });
  it("getSetting SettingInvalidError(무효 저장값) → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    setCalendarThrows("invalid");
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });
  it("getSetting 예상 못한 에러(인프라 장애) → unknown(google 로그)", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setCalendarThrows("infra");
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "google")!.health).toBe("unknown");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("google"), expect.anything());
    spy.mockRestore();
  });
});

describe("templates + 권한 게이트", () => {
  it("templates: secret OK → configured(설정값 불필요)", async () => {
    setSecretHealth({ ...getSecretHealth(), templates: "configured" });
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "templates")!.health).toBe("configured");
  });
  it("integrations.<key>:view 없는 연동은 결과에서 제외", async () => {
    setAllowed(new Set(["integrations.smtp:view"]));
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "", from: "" });
    expect((await getIntegrationStatuses("u1")).map((s) => s.key)).toEqual(["smtp"]);
  });
});
```

실행: `npm test -- tests/modules/integrations/status.test.ts` → **FAIL**(status.ts가 아직 getSetting host/from/port 기반).

### Step 3 — status.ts 재작성

`src/modules/integrations/status.ts`를 아래 전체 내용으로 교체:

```ts
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
```

실행: `npm test -- tests/modules/integrations/status.test.ts` → **PASS**.

### Step 4 — service.ts: `secret.smtp` 행 상태(F12) (FAIL→PASS)

먼저 `tests/kernel/settings/service.test.ts`의 `listSettings` describe에서 기존 "envSecret status=coarse" 테스트(secret.smtp)를 아래로 교체하고 F12 케이스를 추가한다:

```ts
  it("envSecret status=coarse, value 없음 (secret.smtp, SMTP_USER 설정 시 secretHealth 따름)", async () => {
    setAllowed(new Set(["integrations.smtp:view"]));
    const prev = process.env.SMTP_USER; process.env.SMTP_USER = "bob";
    try {
      const items = await listSettings("u1");
      const smtp = items.find((i) => i.key === "secret.smtp")!;
      expect(smtp.status).toBe("configured");
      expect("value" in smtp).toBe(false);
    } finally { if (prev === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = prev; }
  });

  it("secret.smtp 행 상태(F12): SMTP_USER 미설정 → not_required(무인증 릴레이, 그룹 헤더와 일관)", async () => {
    setAllowed(new Set(["integrations.smtp:view"]));
    const prev = process.env.SMTP_USER; delete process.env.SMTP_USER;
    try {
      const items = await listSettings("u1");
      expect(items.find((i) => i.key === "secret.smtp")!.status).toBe("not_required");
    } finally { if (prev !== undefined) process.env.SMTP_USER = prev; }
  });
```

(참고: 이 파일의 `getSecretStatus` mock은 `secret.smtp`만 "configured"를 반환하므로, SMTP_USER 설정 시 secretHealth가 그대로 흐른다.)

실행: `npm test -- tests/kernel/settings/service.test.ts` → **FAIL**(아직 F12 미구현 → SMTP_USER 미설정인데도 "configured").

이제 `src/kernel/settings/service.ts`의 `listSettings`에서 envSecret 분기를 교체:
```ts
    } else if (e.kind === "envSecret") {
      let status: SettingStatus = secretHealth.get(e.key) ?? "attention_required";
      // F12: secret.smtp 행 상태를 전송 auth 분기와 일치. SMTP_USER 미설정(무인증 릴레이)이면
      // 비밀번호 불필요 → not_required(중립). 그룹 헤더(smtpConfigured)와 어긋나지 않게 한다.
      if (e.key === "secret.smtp" && (process.env.SMTP_USER ?? "").length === 0) {
        status = "not_required";
      }
      items.push({ ...base, status });
    } else {
```

(`SettingStatus`는 service.ts가 이미 `./registry`에서 import 중 — task-01에서 확인. 추가 import 불필요.)

실행: `npm test -- tests/kernel/settings/service.test.ts` → **PASS**.

## Acceptance Criteria

```bash
npm test -- tests/modules/integrations/status.test.ts   # PASS (auth 분기 5 + google 5 + templates 2)
npm test -- tests/kernel/settings/service.test.ts        # PASS (F12 포함)
npm run typecheck                                        # 0 errors
npm run lint                                             # 0 errors
```

## Cautions

- **Don't smtp 상태에서 host를 `getSetting`/DB로 읽지 마라.** Reason: host는 env 전용(D2·F4). `getSmtpConfig`의 `cfg.host`(env)를 본다.
- **Don't smtp check를 `safe()`로 감싸지 마라.** Reason: `getSmtpConfig`가 tolerant(throw 없음, D10)라 unknown이 나올 수 없다. safe로 감싸면 의미 없는 3-state가 노출된다. google은 `getSetting`/prisma가 throw할 수 있어 safe 유지.
- **Don't `secret.smtp` 행을 SMTP_USER 무관하게 "configured/설정 필요" 2-state로 두지 마라.** Reason: F12 — 무인증 릴레이(user 없음)면 비밀번호가 불필요한데 "설정 필요"로 뜨면 그룹 헤더(정상)와 모순(원래 버그 재발). `not_required` 중립이 필요.
- **Don't `IntegrationHealth`에서 `"unknown"`을 제거하지 마라.** Reason: google 경로가 여전히 unknown(인프라 장애 구분)을 쓴다. 페이지도 unknown 라벨을 렌더한다.
