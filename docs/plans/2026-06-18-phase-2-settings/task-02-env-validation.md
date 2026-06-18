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

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  SMTP_PASSWORD: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  LIBREOFFICE_PATH: z.string().optional(),
  TEMPLATE_DIR: z.string().optional(),
  OUTPUT_DIR: z.string().optional(),
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
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return result.data;
}

export const env: Env = parseEnv();

export type SecretHealth = "configured" | "attention_required";
export type SecretVar = { name: string; kind: "value" | "filePath" };
export interface SecretStatus {
  id: string;
  health: SecretHealth;
}

function probeVar(v: SecretVar): boolean {
  const raw = process.env[v.name];
  if (!raw || raw.trim() === "") return false;
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

기대: 5 테스트 통과(boot 2 + status 3). 기존 `tests/lib/prisma.test.ts` 등 영향 없음.

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

- `npm test -- env` → 5 PASS.
- `getSecretStatus` 반환 객체 키는 `{ id, health }`만(값·변수명·경로 부재).
- required env 누락 시 `import("@/lib/env")`가 throw.
- `npm run typecheck` / `npm run lint` → 에러 0.

## Cautions

- **`index.ts` 첫 줄 `import "server-only";` 필수. 이유:** `env`/`getSecretStatus`가 클라이언트로 새면 secret 인벤토리 노출.
- **`getSecretStatus` 반환에 값·env 변수명·파일 경로·detail을 절대 넣지 말 것. 이유:** Codex Finding 4(토폴로지 누출). coarse 2-상태만.
- **`lib/env`에서 `@/kernel/*`·`@/modules/*` import 금지. 이유:** Phase 1 boundaries(lib→lib만). 카탈로그 연결은 호출자(service)가 spec 주입으로 처리.
- **테스트는 `vi.resetModules()` + 동적 `import()`로 작성. 이유:** `env`가 모듈 로드 시 1회 parse되므로 정적 import면 process.env 조작 전에 평가된다.
