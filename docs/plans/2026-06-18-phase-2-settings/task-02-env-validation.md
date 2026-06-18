# Task 02 — lib/env: env Zod(boot fail-fast) + getSecretStatus(coarse)

**Purpose:** secret/env를 `lib/env` 한 곳으로 모은다. 앱 부팅 시 required env를 Zod로 검증(fail-fast)하고, 설정 화면용 **coarse 상태**(`configured`/`attention_required`)만 노출해 secret 값·변수명·경로 누출을 막는다.

## Files

- Create: `src/lib/env/schema.ts` — env Zod 스키마(entrypoint §SC-5).
- Create: `src/lib/env/index.ts` — `env`(boot parse) + `getSecretStatus`(server-only).
- Test: `tests/lib/env/env.test.ts`.

## Prep

- spec §6, entrypoint §SC-1·§SC-5.
- 경계: `lib/env`는 lib만 의존. **카탈로그(kernel/settings) import 금지** → `getSecretStatus`는 호출자가 spec을 넘긴다.

## Deps

없음.

## TDD steps

### 1. 실패 테스트 작성 — `tests/lib/env/env.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  vi.resetModules();
});
beforeEach(() => vi.resetModules());

describe("lib/env boot 검증", () => {
  it("required env 누락 시 import에서 throw(fail-fast)", async () => {
    delete process.env.DATABASE_URL;
    process.env.NEXTAUTH_SECRET = "x";
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("required env 충족 시 env 노출", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.NEXTAUTH_SECRET = "secret";
    const mod = await import("@/lib/env");
    expect(mod.env.DATABASE_URL).toBe("postgresql://localhost/db");
  });

  it("NEXTAUTH_SECRET 없이 AUTH_SECRET만 있어도 통과(Phase 1 auth 정합)", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    delete process.env.NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = "secret";
    const mod = await import("@/lib/env");
    expect(mod.env.AUTH_SECRET).toBe("secret");
  });

  it("NEXTAUTH_SECRET·AUTH_SECRET 둘 다 없으면 throw", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    await expect(import("@/lib/env")).rejects.toThrow();
  });
});

describe("getSecretStatus (coarse)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.NEXTAUTH_SECRET = "secret";
  });

  it("value var 존재→configured, 누락→attention_required", async () => {
    process.env.SMTP_PASSWORD = "pw";
    delete process.env.LIBREOFFICE_PATH;
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([
      { id: "secret.smtp", vars: [{ name: "SMTP_PASSWORD", kind: "value" }] },
      { id: "secret.libreoffice", vars: [{ name: "LIBREOFFICE_PATH", kind: "filePath" }] },
    ]);
    expect(out).toEqual([
      { id: "secret.smtp", health: "configured" },
      { id: "secret.libreoffice", health: "attention_required" },
    ]);
  });

  it("filePath var는 실제 파일 존재로 판정", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "./package.json"; // 실재 파일
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([
      { id: "secret.google", vars: [{ name: "GOOGLE_APPLICATION_CREDENTIALS", kind: "filePath" }] },
    ]);
    expect(out[0]).toEqual({ id: "secret.google", health: "configured" });
  });

  it("값/변수명/경로를 반환에 포함하지 않는다", async () => {
    process.env.SMTP_PASSWORD = "super-secret-value";
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([{ id: "secret.smtp", vars: [{ name: "SMTP_PASSWORD", kind: "value" }] }]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("super-secret-value");
    expect(json).not.toContain("SMTP_PASSWORD");
    expect(Object.keys(out[0]).sort()).toEqual(["health", "id"]);
  });

  it("aliases: 대체 변수(AUTH_SECRET)만 있어도 configured", async () => {
    delete process.env.NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = "s";
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([
      { id: "secret.auth", vars: [{ name: "NEXTAUTH_SECRET", kind: "value", aliases: ["AUTH_SECRET"] }] },
    ]);
    expect(out[0]).toEqual({ id: "secret.auth", health: "configured" });
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- env
```

기대: `Cannot find module '@/lib/env'`.

### 3. schema.ts 구현 — `src/lib/env/schema.ts`

```ts
import { z } from "zod";

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    // NextAuth v5는 AUTH_SECRET을 정식 이름으로 받고, 기존 auth config는 `NEXTAUTH_SECRET ?? AUTH_SECRET`.
    // 둘 다 optional로 두고 아래 refine으로 "둘 중 하나 필수"를 표현(Codex 3차 F4).
    NEXTAUTH_SECRET: z.string().min(1).optional(),
    AUTH_SECRET: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    LIBREOFFICE_PATH: z.string().optional(),
    TEMPLATE_DIR: z.string().optional(),
    OUTPUT_DIR: z.string().optional(),
  })
  .refine((d) => Boolean(d.NEXTAUTH_SECRET || d.AUTH_SECRET), {
    message: "NEXTAUTH_SECRET or AUTH_SECRET is required",
  });

export type Env = z.infer<typeof envSchema>;
```

### 4. index.ts 구현 — `src/lib/env/index.ts`

```ts
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
```

### 5. 실행 → PASS

```bash
npm test -- env
```

기대: 8 테스트 통과(boot 4 + status 4). 기존 `tests/lib/prisma.test.ts` 등 영향 없음.

### 6. typecheck/lint

```bash
npm run typecheck && npm run lint
```

### 7. 커밋

```bash
git add src/lib/env/schema.ts src/lib/env/index.ts tests/lib/env/env.test.ts
git commit -m "Add lib/env: boot-time env validation and coarse secret status"
```

## Acceptance Criteria

- `npm test -- env` → 8 PASS.
- `getSecretStatus` 반환 객체 키는 `{ id, health }`만(값·변수명·경로 부재).
- required env 누락 시 `import("@/lib/env")`가 throw.
- `npm run typecheck` / `npm run lint` → 에러 0.

## Cautions

- **`index.ts` 첫 줄 `import "server-only";` 필수. 이유:** `env`/`getSecretStatus`가 클라이언트로 새면 secret 인벤토리 노출.
- **`getSecretStatus` 반환에 값·env 변수명·파일 경로·detail을 절대 넣지 말 것. 이유:** Codex Finding 4(토폴로지 누출). coarse 2-상태만.
- **auth secret을 `NEXTAUTH_SECRET` 단독 필수로 두지 말 것 — `AUTH_SECRET` 대체 허용. 이유:** Codex 3차 F4 — `src/lib/auth/config.ts`가 `NEXTAUTH_SECRET ?? AUTH_SECRET`을 받으므로, schema는 refine으로 "둘 중 하나 필수", 상태는 `aliases`로 "하나라도 present면 configured". AUTH_SECRET-only 배포가 boot fail 하지 않게 한다.
- **`lib/env`에서 `@/kernel/*`·`@/modules/*` import 금지. 이유:** Phase 1 boundaries(lib→lib만). 카탈로그 연결은 호출자(service)가 spec 주입으로 처리.
- **테스트는 `vi.resetModules()` + 동적 `import()`로 작성. 이유:** `env`가 모듈 로드 시 1회 parse되므로 정적 import면 process.env 조작 전에 평가된다.
