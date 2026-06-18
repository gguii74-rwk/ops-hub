# Task 01 — registry 타입·에러 + 카탈로그 조립 + 정합성 테스트

**Purpose:** settings registry의 1차 요소(타입·에러)와 Phase 2 구체 카탈로그를 만들고, 카탈로그 정합성(키 문법·필수 필드·집합 분리)을 테스트로 고정한다.

## Files

- Create: `tests/stubs/empty-module.ts` — `server-only`/`client-only` vitest stub.
- Modify: `vitest.config.ts` — `server-only`·`client-only` alias 추가.
- Create: `src/kernel/settings/registry.ts` — 타입·에러(entrypoint §SC-2).
- Create: `src/kernel/settings/catalog.ts` — Phase 2 항목(entrypoint §SC-4) + 조회 헬퍼.
- Test: `tests/kernel/settings/catalog.test.ts` — 정합성.

## Prep

- spec §2·§4·§5(타입/카탈로그), entrypoint §SC-1·§SC-2·§SC-4.
- 의존 없음(첫 task). `Action`은 Phase 1 `src/kernel/access`에서 import.

## Deps

없음.

## TDD steps

### 0. vitest `server-only` stub 설정 (먼저)

Phase 2 모듈 다수가 `import "server-only";`를 갖는다. vitest는 node 환경이라 `server-only`(및 `client-only`)가 import 시 throw한다. 테스트가 이 모듈들을 import할 수 있도록 빈 모듈로 alias한다.

Create `tests/stubs/empty-module.ts`:

```ts
export {};
```

Modify `vitest.config.ts` — `resolve.alias`에 두 줄 추가:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/empty-module.ts", import.meta.url)),
      "client-only": fileURLToPath(new URL("./tests/stubs/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

검증: 기존 테스트가 여전히 통과해야 한다 — `npm test` (Phase 1 22 + 신규는 아직 없음).

### 1. 실패 테스트 작성 — `tests/kernel/settings/catalog.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { CATALOG, getEntry, SYSTEM_KEYS } from "@/kernel/settings/catalog";
import type { SettingEntry } from "@/kernel/settings/registry";

const KEY_GRAMMAR = /^[a-z]+(\.[a-zA-Z]+)+$/; // <module>.<feature>.<setting>

describe("settings catalog 정합성", () => {
  it("모든 엔트리에 key·category·order·title·description·permission 존재", () => {
    for (const e of CATALOG) {
      expect(e.key, `${e.key} key`).toBeTruthy();
      expect(["security", "integrations", "workflows", "general"]).toContain(e.category);
      expect(typeof e.order).toBe("number");
      expect(e.title).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.permission.resource, `${e.key} resource`).toBeTruthy();
      expect(e.permission.action, `${e.key} action`).toBeTruthy();
    }
  });

  it("key는 카탈로그 내 유일", () => {
    const keys = CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("systemSetting 엔트리는 key 문법·schema·default·audit·fallbackSafe 보유", () => {
    const sys = CATALOG.filter((e): e is Extract<SettingEntry, { kind: "systemSetting" }> => e.kind === "systemSetting");
    expect(sys.length).toBeGreaterThan(0);
    for (const e of sys) {
      expect(e.key, `${e.key} grammar`).toMatch(KEY_GRAMMAR);
      expect(e.schema).toBeTruthy();
      expect(e.default !== undefined, `${e.key} default`).toBe(true);
      expect(["full", "redacted", "summary"]).toContain(e.audit);
      expect(typeof e.fallbackSafe).toBe("boolean");
    }
  });

  it("systemSetting default는 자신의 schema를 통과", () => {
    for (const e of CATALOG) {
      if (e.kind !== "systemSetting") continue;
      expect(e.schema.safeParse(e.default).success, `${e.key} default valid`).toBe(true);
    }
  });

  it("SYSTEM_KEYS는 systemSetting 키 집합과 일치", () => {
    const sys = CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key);
    expect([...SYSTEM_KEYS].sort()).toEqual(sys.sort());
  });

  it("systemSetting key 집합과 envSecret envVars 이름 집합은 무교집합", () => {
    const sysKeys = new Set(CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key));
    const envNames = new Set(
      CATALOG.flatMap((e) => (e.kind === "envSecret" ? e.envVars.map((v) => v.name) : [])),
    );
    for (const n of envNames) expect(sysKeys.has(n), `${n} overlaps systemSetting key`).toBe(false);
  });

  it("getEntry는 등록 key를 찾고 미등록은 undefined", () => {
    expect(getEntry("integrations.smtp.host")?.kind).toBe("systemSetting");
    expect(getEntry("nope.nope.nope")).toBeUndefined();
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- catalog
```

기대: `Cannot find module '@/kernel/settings/catalog'` (모듈 미존재).

### 3. registry.ts 구현 — `src/kernel/settings/registry.ts`

> 전체 코드는 entrypoint §SC-2와 동일. 그대로 작성한다(server-only 아님 — type/에러만, prisma는 `import type`).

```ts
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
  envVars: Array<{ name: string; kind: "value" | "filePath" }>;
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
```

### 4. catalog.ts 구현 — `src/kernel/settings/catalog.ts`

```ts
import "server-only";
import { z } from "zod";
import type { SettingEntry } from "./registry";

export const CATALOG: readonly SettingEntry[] = [
  // --- security (envSecret) ---
  {
    kind: "envSecret",
    key: "secret.database",
    category: "security",
    order: 10,
    title: "데이터베이스 연결",
    description: "PostgreSQL 연결 문자열(런타임 secret).",
    permission: { resource: "admin.settings", action: "view" },
    envVars: [{ name: "DATABASE_URL", kind: "value" }],
  },
  {
    kind: "envSecret",
    key: "secret.auth",
    category: "security",
    order: 11,
    title: "인증 secret",
    description: "NextAuth 세션 서명 secret.",
    permission: { resource: "admin.settings", action: "view" },
    envVars: [{ name: "NEXTAUTH_SECRET", kind: "value" }],
  },
  // --- integrations (envSecret) ---
  {
    kind: "envSecret",
    key: "secret.google",
    category: "integrations",
    order: 20,
    title: "Google 서비스 계정",
    description: "Google API 서비스 계정 키 파일.",
    permission: { resource: "integrations.google", action: "view" },
    envVars: [{ name: "GOOGLE_APPLICATION_CREDENTIALS", kind: "filePath" }],
  },
  {
    kind: "envSecret",
    key: "secret.smtp",
    category: "integrations",
    order: 21,
    title: "SMTP 비밀번호",
    description: "메일 발송 SMTP 계정 비밀번호.",
    permission: { resource: "integrations.smtp", action: "view" },
    envVars: [{ name: "SMTP_PASSWORD", kind: "value" }],
  },
  {
    kind: "envSecret",
    key: "secret.libreoffice",
    category: "integrations",
    order: 22,
    title: "LibreOffice 경로",
    description: "PDF 변환용 LibreOffice 실행 파일 경로.",
    permission: { resource: "integrations.templates", action: "view" },
    envVars: [{ name: "LIBREOFFICE_PATH", kind: "filePath" }],
  },
  // --- integrations (systemSetting) ---
  {
    kind: "systemSetting",
    key: "integrations.smtp.host",
    category: "integrations",
    order: 30,
    title: "SMTP 호스트",
    description: "메일 발송 서버 호스트명.",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.string(), // 빈 문자열="미설정"으로 허용. 완성도 판정은 integrations 상태(task-06)가 length>0로 본다.
    default: "",
    audit: "full",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.smtp.port",
    category: "integrations",
    order: 31,
    title: "SMTP 포트",
    description: "메일 발송 서버 포트(1–65535).",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.coerce.number().int().min(1).max(65535),
    default: 587,
    audit: "full",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.smtp.fromAddress",
    category: "integrations",
    order: 32,
    title: "발신 주소",
    description: "메일 기본 발신 이메일 주소.",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.string().email().or(z.literal("")), // 빈 문자열="미설정" 허용, 그 외엔 이메일 형식
    default: "",
    audit: "summary",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.google.calendarIds",
    category: "integrations",
    order: 33,
    title: "Google 캘린더 목록",
    description: "동기화 대상 Google 캘린더 ID 목록.",
    permission: { resource: "integrations.google", action: "configure" },
    schema: z.array(z.string().min(1)),
    default: [],
    audit: "summary",
    fallbackSafe: false,
  },
  // --- workflows (systemSetting) ---
  {
    kind: "systemSetting",
    key: "workflows.weeklyReport.defaultRecipients",
    category: "workflows",
    order: 40,
    title: "주간보고 기본 수신자",
    description: "주간보고 메일 기본 수신자 이메일 목록.",
    permission: { resource: "workflows.weekly", action: "configure" },
    schema: z.array(z.string().email()),
    default: [],
    audit: "summary",
    fallbackSafe: true,
  },
  // --- workflows (relational, 편집기 Phase 4) ---
  {
    kind: "relational",
    key: "workflows.billing.config",
    category: "workflows",
    order: 41,
    title: "대금청구 설정",
    description: "연도별 계약·청구 설정(전용 화면에서 관리, Phase 4).",
    permission: { resource: "workflows.billing", action: "configure" },
    model: "BillingConfig",
    manageHref: "/admin/settings/billing",
  },
];

export const SYSTEM_KEYS: ReadonlySet<string> = new Set(
  CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key),
);

export function getEntry(key: string): SettingEntry | undefined {
  return CATALOG.find((e) => e.key === key);
}
```

### 5. 실행 → PASS

```bash
npm test -- catalog
```

기대: 7 테스트 통과.

### 6. typecheck/lint

```bash
npm run typecheck && npm run lint
```

### 7. 커밋

```bash
git add vitest.config.ts tests/stubs/empty-module.ts src/kernel/settings/registry.ts src/kernel/settings/catalog.ts tests/kernel/settings/catalog.test.ts
git commit -m "Add settings registry types and Phase 2 catalog"
```

## Acceptance Criteria

- `npm test -- catalog` → catalog 테스트 전부 PASS.
- `npm run typecheck` → 에러 0. `npm run lint` → 에러 0.
- `CATALOG`에 systemSetting 5종(smtp host/port/fromAddress, google calendarIds, weekly recipients), envSecret 5종, relational 1종 존재.

## Cautions

- **`catalog.ts` 첫 줄 `import "server-only";` 누락 금지. 이유:** Zod 스키마·설정 메타·env 변수명이 클라이언트 번들로 유입되면 Codex Finding 2(메타 누출)가 재발한다.
- **`registry.ts`에 `import "server-only"` 넣지 말 것. 이유:** registry는 타입·에러뿐이며 client 컴포넌트(useCan 등 향후)가 타입을 참조할 수 있어야 한다. prisma는 반드시 `import type`로만.
- **systemSetting `key`에 secret/비밀번호류 키를 추가하지 말 것. 이유:** systemSetting은 DB 평문 저장이라 secret 정책 위반(§SC-4·§3.3).
- **`CATALOG`에 `as const`를 붙이지 말 것. 이유:** `as const`면 배열 default(`[]`)가 `readonly`가 되어 `Prisma.InputJsonValue`(가변 배열) 할당에서 typecheck가 깨진다. Phase 2는 `getSetting`이 `unknown` 반환(SC-3)이라 typed key 매핑이 불필요하므로 `as const`도 불필요. 타입 매핑이 필요해지는 후속에서 도입한다.
