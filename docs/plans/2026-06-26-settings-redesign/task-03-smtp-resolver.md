# Task 03 — kernel `getSmtpConfig` 해석기 + reader re-export

**Purpose**: SMTP 전송 config를 해석하는 `getSmtpConfig()`를 kernel `service.ts`에 추가하고 `reader.ts`에서 re-export한다. host/user/secure는 env 전용(D2·F4), port/from은 `readRaw`로 DB 우선·env 폴백(F7), **절대 throw하지 않는다**(D10·F2).

## Files

- Modify `src/kernel/settings/service.ts` — `getSmtpConfig` 추가.
- Modify `src/kernel/settings/reader.ts` — `getSmtpConfig` re-export.
- Create `tests/kernel/settings/smtp-config.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts SC-1(`MailTransportConfig`), SC-2(`getSmtpConfig` 필드 출처), SC-7(경계).
- spec §5.2.
- **Deps: task-02**(`MailTransportConfig` 타입이 lib에 존재해야 함).

## TDD steps

### Step 1 — getSmtpConfig 테스트 작성(FAIL 유도)

`tests/kernel/settings/smtp-config.test.ts` 신규 생성:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// readRaw를 교체 가능한 impl로 mock(tolerant 테스트에서 throw 주입).
const { store, getReadRaw, setReadRaw } = vi.hoisted(() => {
  const store = new Map<string, { value: unknown; updatedAt: Date }>();
  let impl: (k: string) => Promise<{ value: unknown; updatedAt: Date } | null> = async (k) => store.get(k) ?? null;
  return { store, getReadRaw: () => impl, setReadRaw: (fn: typeof impl) => { impl = fn; } };
});
vi.mock("@/kernel/settings/repository", () => ({ readRaw: (k: string) => getReadRaw()(k), writeWithAudit: vi.fn() }));
// service.ts top-level import 부수효과 차단(getSmtpConfig는 access/env를 호출하지 않음).
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn(), requirePermission: vi.fn() }));
vi.mock("@/lib/env", () => ({ getSecretStatus: vi.fn(() => []) }));

import { getSmtpConfig } from "@/kernel/settings/reader";

const ENV_KEYS = ["SMTP_HOST", "SMTP_USER", "SMTP_SECURE", "SMTP_PORT", "SMTP_FROM"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  store.clear();
  setReadRaw(async (k) => store.get(k) ?? null);
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("getSmtpConfig — env 전용 필드(host/user/secure, D2·F4)", () => {
  it("host/user/secure는 env에서만 읽는다(DB row 있어도 무시)", async () => {
    process.env.SMTP_HOST = "mail.x";
    process.env.SMTP_USER = "bob";
    process.env.SMTP_SECURE = "true";
    store.set("integrations.smtp.host", { value: "db-ignored", updatedAt: new Date() });
    const cfg = await getSmtpConfig();
    expect(cfg.host).toBe("mail.x");
    expect(cfg.user).toBe("bob");
    expect(cfg.secure).toBe(true);
  });
  it("env 미설정 → host/user '', secure false", async () => {
    expect(await getSmtpConfig()).toMatchObject({ host: "", user: "", secure: false });
  });
});

describe("getSmtpConfig — port(F7 readRaw, DB 우선·env 폴백)", () => {
  it("행 부재 + SMTP_PORT=465(≠587) → 465(587 default가 env를 가리지 않음)", async () => {
    process.env.SMTP_PORT = "465";
    expect((await getSmtpConfig()).port).toBe(465);
  });
  it("행 부재 + env도 없음 → 587", async () => {
    expect((await getSmtpConfig()).port).toBe(587);
  });
  it("행 존재+유효 → DB 값(env 무시)", async () => {
    process.env.SMTP_PORT = "465";
    store.set("integrations.smtp.port", { value: 2525, updatedAt: new Date() });
    expect((await getSmtpConfig()).port).toBe(2525);
  });
  it("행 존재+무효(범위 밖) → env 폴백, throw 없음(D10)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SMTP_PORT = "465";
    store.set("integrations.smtp.port", { value: 70000, updatedAt: new Date() });
    expect((await getSmtpConfig()).port).toBe(465);
    warn.mockRestore();
  });
});

describe("getSmtpConfig — from(readRaw, DB 우선·env 폴백)", () => {
  it("행 존재+비어있지 않음 → DB", async () => {
    process.env.SMTP_FROM = "envfrom@x.com";
    store.set("integrations.smtp.fromAddress", { value: "dbfrom@x.com", updatedAt: new Date() });
    expect((await getSmtpConfig()).from).toBe("dbfrom@x.com");
  });
  it("행 부재 → env SMTP_FROM", async () => {
    process.env.SMTP_FROM = "envfrom@x.com";
    expect((await getSmtpConfig()).from).toBe("envfrom@x.com");
  });
  it("행 빈 문자열 → env 폴백(빈값은 DB로 안 침)", async () => {
    process.env.SMTP_FROM = "envfrom@x.com";
    store.set("integrations.smtp.fromAddress", { value: "", updatedAt: new Date() });
    expect((await getSmtpConfig()).from).toBe("envfrom@x.com");
  });
  it("행 무효(비어있지 않은 비-이메일) + 유효 env SMTP_FROM → env 폴백, throw 없음(P1·D10)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SMTP_FROM = "envfrom@x.com";
    store.set("integrations.smtp.fromAddress", { value: "not-an-email", updatedAt: new Date() });
    expect((await getSmtpConfig()).from).toBe("envfrom@x.com"); // 무효 행이 env를 덮지 않음
    warn.mockRestore();
  });
  it("env 전부 없음 → 기본 noreply", async () => {
    expect((await getSmtpConfig()).from).toBe("noreply@uracle.co.kr");
  });
});

describe("getSmtpConfig — tolerant(D10·F2, 절대 throw 안 함)", () => {
  it("readRaw throw(인프라 장애) + env present → env config로 해석, throw 없음", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SMTP_HOST = "mail.x";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_FROM = "envfrom@x.com";
    setReadRaw(async () => { throw new Error("DB down"); });
    const cfg = await getSmtpConfig();
    expect(cfg).toMatchObject({ host: "mail.x", port: 2525, from: "envfrom@x.com" });
    warn.mockRestore();
  });
});
```

실행: `npm test -- tests/kernel/settings/smtp-config.test.ts` → **FAIL**(`getSmtpConfig` export 없음).

### Step 2 — service.ts에 getSmtpConfig 추가

`src/kernel/settings/service.ts` 상단 import에 타입 추가(`import type` — 런타임 lib 로드 없음, 경계 안전):
```ts
import type { MailTransportConfig } from "@/lib/integrations/mail";
```
(`getEntry`·`readRaw`는 service.ts가 이미 import 중 — `import { CATALOG, getEntry } from "./catalog";`, `import { readRaw, writeWithAudit } from "./repository";`. 추가 import 불필요.)

`getSetting` 함수 정의 **아래**에 추가:
```ts
// --- SMTP 전송 config 해석기(D1·D2·D10, F2·F7) ---
// host/user/secure는 env 전용(D2·F4 — DB 편집 host에 전역 env 비밀번호 주입 시 유출 벡터).
// port/from은 readRaw로 행 부재/빈값/무효를 구분(F7: getSetting은 행 부재 시 default 587을 반환해 비-587 env를 가린다).
// 절대 throw하지 않는다(D10·F2): DB 읽기/파싱 실패도 env 폴백 + console.warn만. 두 mail 호출자가 무조건 await하므로
// 여기서 throw하면 env가 멀쩡해도 발송이 막힌다. 깨진 행은 listSettings 항목별 INVALID 배지로 별도 노출(신호 보존).
export async function getSmtpConfig(): Promise<MailTransportConfig> {
  const host = process.env.SMTP_HOST ?? "";
  const user = process.env.SMTP_USER ?? "";
  const secure = process.env.SMTP_SECURE === "true";

  let port = Number(process.env.SMTP_PORT ?? 587);
  if (!Number.isFinite(port)) port = 587; // env SMTP_PORT 무효 방어
  try {
    const row = await readRaw("integrations.smtp.port");
    if (row) {
      const n = typeof row.value === "number" ? row.value : Number(row.value);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) port = n;
      else console.warn("[settings] invalid integrations.smtp.port row; using env/default");
    }
  } catch (e) {
    console.warn("[settings] failed reading integrations.smtp.port; using env/default", e);
  }

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
```

### Step 3 — reader.ts re-export

`src/kernel/settings/reader.ts`의 첫 export 줄을 교체:
```ts
export { getSetting, getSmtpConfig } from "./service";
```
(`SettingInvalidError` re-export 줄은 그대로 둔다.)

실행: `npm test -- tests/kernel/settings/smtp-config.test.ts` → **PASS**.

## Acceptance Criteria

```bash
npm test -- tests/kernel/settings/smtp-config.test.ts   # PASS (12 케이스)
npm test -- tests/kernel/settings                        # 기존 catalog/service/repository 회귀 없음
npm run typecheck                                        # 0 errors
npm run lint                                             # 0 errors — kernel→lib import type 허용
```

## Cautions

- **Don't port를 `getSetting("integrations.smtp.port")`로 읽지 마라.** Reason: F7 — `getSetting`은 행 부재 시 카탈로그 default(587)를 반환해 비-587 env(465/2525)를 조용히 덮는다. 반드시 `readRaw`로 **행 부재 vs 존재**를 구분한다.
- **Don't `getSmtpConfig`에서 throw하지 마라(어떤 경로든).** Reason: D10·F2 — 두 mail 호출자가 무조건 await하므로 여기서 throw하면 유효한 env SMTP로도 발송이 막힌다(D1 무회귀 위반). 모든 DB 접근은 try/catch + env 폴백.
- **Don't `import { MailTransportConfig }`(값 import)로 쓰지 마라 — `import type`만.** Reason: 메일 lib은 `nodemailer`/`server-only`를 끌어온다. 값 import면 kernel이 런타임에 그걸 로드한다(불필요). 타입은 erase된다.
- **Don't 비밀번호를 config에 넣지 마라.** Reason: D2 — `MailTransportConfig`에 password 필드 없음. 전송 시 lib이 env에서 직접 읽는다.
