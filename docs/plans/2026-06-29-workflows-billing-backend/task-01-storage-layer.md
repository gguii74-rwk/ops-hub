# Task 01 — 파일 저장소 계층 + STORAGE_ROOT env

**Purpose:** `STORAGE_ROOT` 단일 env와 `src/lib/storage/`(템플릿 읽기·산출물 경로 해석·traversal 가드)를 신설한다. 모든 경로가 strict(절대·`..`·prefix 위반 throw) — 후속 task(생성기·발송·다운로드)의 보안 기반(spec §4, D2·D3·D13·F4·I4).

## Files

- **Modify:** `src/lib/env/schema.ts` — `STORAGE_ROOT` 추가
- **Create:** `src/lib/storage/index.ts` — 헬퍼(§Shared Contracts SC-2)
- **Create (test):** `tests/lib/storage/storage.test.ts`

## Prep

- 읽기: spec §4(전체), entrypoint §Shared Contracts SC-1·SC-2.
- 기존 `src/lib/env/schema.ts`는 `TEMPLATE_DIR`/`OUTPUT_DIR`을 이미 갖지만 **건드리지 않는다**(레거시, 이 슬라이스 미사용). `STORAGE_ROOT`만 추가.
- vitest는 `server-only`를 `tests/stubs/empty-module.ts`로 alias하므로 `import "server-only"` 모듈도 테스트 가능(vitest.config.ts 확인됨).

## Deps

없음.

## TDD steps

### 1. 실패 테스트 작성 — `tests/lib/storage/storage.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  getStorageRoot, getTemplateRoot, getOutputRoot,
  resolveStoragePath, resolveTemplatePath, resolveOutputPath, toStoredOutputPath,
} from "@/lib/storage";

const ROOT = path.join(os.tmpdir(), "ops-hub-storage-test");

describe("lib/storage strict resolver (F4·I4·D2·D13)", () => {
  beforeEach(() => { process.env.STORAGE_ROOT = ROOT; });
  afterEach(() => { delete process.env.STORAGE_ROOT; });

  it("STORAGE_ROOT 미설정이면 throw(fail-closed)", () => {
    delete process.env.STORAGE_ROOT;
    expect(() => getStorageRoot()).toThrow();
  });
  it("STORAGE_ROOT가 상대경로면 throw", () => {
    process.env.STORAGE_ROOT = "relative/dir";
    expect(() => getStorageRoot()).toThrow();
  });
  it("template/output root", () => {
    expect(getTemplateRoot()).toBe(path.join(ROOT, "Template"));
    expect(getOutputRoot()).toBe(path.join(ROOT, "out"));
  });
  it("out/… 상대 → 절대(root 하위)", () => {
    expect(resolveStoragePath("out/workflows/t1/a.hwpx")).toBe(path.resolve(ROOT, "out/workflows/t1/a.hwpx"));
  });
  it("Template/… 상대 → 절대", () => {
    expect(resolveStoragePath("Template/대금청구/x.hwpx")).toBe(path.resolve(ROOT, "Template/대금청구/x.hwpx"));
  });
  it("절대경로 거부", () => {
    expect(() => resolveStoragePath("/etc/passwd")).toThrow();
  });
  it("드라이브 경로 거부", () => {
    expect(() => resolveStoragePath("C:/Windows/x")).toThrow();
  });
  it(".. 포함 거부", () => {
    expect(() => resolveStoragePath("out/../../etc")).toThrow();
  });
  it("허용 안 된 prefix 거부", () => {
    expect(() => resolveStoragePath("keys/secret")).toThrow();
    expect(() => resolveStoragePath("foo/bar")).toThrow();
    expect(() => resolveStoragePath("")).toThrow();
  });
  it("resolveTemplatePath/resolveOutputPath는 strict 기반", () => {
    expect(resolveTemplatePath("대금청구/x")).toBe(path.resolve(ROOT, "Template/대금청구/x"));
    expect(resolveOutputPath("workflows/t1")).toBe(path.resolve(ROOT, "out/workflows/t1"));
    expect(() => resolveOutputPath("../../etc")).toThrow();
  });
  it("toStoredOutputPath: out 하위 절대 → out/… 상대(POSIX)", () => {
    const abs = path.resolve(ROOT, "out/workflows/t1/a.hwpx");
    expect(toStoredOutputPath(abs)).toBe("out/workflows/t1/a.hwpx");
  });
  it("toStoredOutputPath: out 밖이면 throw(I4)", () => {
    expect(() => toStoredOutputPath(path.resolve(ROOT, "Template/x"))).toThrow();
    expect(() => toStoredOutputPath(path.join(os.tmpdir(), "elsewhere"))).toThrow();
  });
});
```

### 2. 실행 → FAIL 확인

```bash
npm test -- tests/lib/storage/storage.test.ts
```
모듈 미존재로 import 실패 = 예상된 FAIL.

### 3. 최소 구현 — `src/lib/storage/index.ts`

```ts
import "server-only";
import path from "node:path";

// DB에 저장 가능한 storage-relative 경로의 1세그먼트 prefix만 허용(D2). keys/ 등은 이 계층 밖.
const ALLOWED_PREFIXES = ["Template", "out"] as const;
type AllowedPrefix = (typeof ALLOWED_PREFIXES)[number];

// STORAGE_ROOT(절대경로). 미설정·상대경로면 throw(fail-closed, spec §4.5).
export function getStorageRoot(): string {
  const root = process.env.STORAGE_ROOT;
  if (!root || !path.isAbsolute(root)) {
    throw new Error("STORAGE_ROOT가 설정되지 않았거나 절대경로가 아닙니다.");
  }
  return root;
}

export function getTemplateRoot(): string {
  return path.join(getStorageRoot(), "Template");
}

export function getOutputRoot(): string {
  return path.join(getStorageRoot(), "out");
}

// STRICT(F4·I4): "Template/…" 또는 "out/…" 상대 POSIX 경로만 → 절대경로.
// 절대·드라이브·.. 포함·prefix 불일치·root 이탈은 전부 throw(통과 경로 없음).
export function resolveStoragePath(stored: string): string {
  const root = getStorageRoot();
  if (path.isAbsolute(stored) || /^[A-Za-z]:/.test(stored)) {
    throw new Error(`저장 경로는 절대경로일 수 없습니다: ${stored}`);
  }
  const segments = stored.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    throw new Error(`경로에 ..를 포함할 수 없습니다: ${stored}`);
  }
  if (!ALLOWED_PREFIXES.includes(segments[0] as AllowedPrefix)) {
    throw new Error(`허용되지 않은 경로 prefix: ${stored}`);
  }
  const resolved = path.resolve(root, segments.join("/"));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`경로가 STORAGE_ROOT를 벗어납니다: ${stored}`);
  }
  return resolved;
}

export function resolveTemplatePath(rel: string): string {
  return resolveStoragePath(`Template/${rel}`);
}

export function resolveOutputPath(rel: string): string {
  return resolveStoragePath(`out/${rel}`);
}

// <root>/out 하위 절대경로 → "out/…" 상대(POSIX). 하위가 아니면 throw(절대경로를 DB에 저장하지 않음, I4).
export function toStoredOutputPath(abs: string): string {
  const outRoot = getOutputRoot();
  if (abs !== outRoot && !abs.startsWith(outRoot + path.sep)) {
    throw new Error(`out 하위 경로가 아닙니다: ${abs}`);
  }
  return path.relative(getStorageRoot(), abs).split(path.sep).join("/");
}
```

### 4. env 추가 — `src/lib/env/schema.ts`

`OUTPUT_DIR: z.string().optional(),` 줄 **다음에** 추가:

```ts
    STORAGE_ROOT: z.string().optional(),
```

(런타임 fail-closed는 `getStorageRoot()`가 담당한다. env 파싱 단계에서 required로 두면 `lint`/`typecheck`/`build`/`test`가 DB·스토리지 없이도 통과해야 하는 CLAUDE.md 규약을 깬다.)

### 5. 실행 → PASS

```bash
npm test -- tests/lib/storage/storage.test.ts
```

### 6. commit

```bash
git add src/lib/storage/index.ts src/lib/env/schema.ts tests/lib/storage/storage.test.ts
git commit -m "feat(workflows): STORAGE_ROOT + lib/storage strict 경로 해석 계층"
```

## Acceptance Criteria

- `npm test -- tests/lib/storage/storage.test.ts` 전건 PASS(절대·드라이브·`..`·prefix·root 이탈 모두 throw 검증).
- `npm run typecheck` / `npm run lint` 통과(boundaries — `lib/storage`는 lib 계층이라 모듈이 import 가능).

## Cautions

- **Don't** day-sync `lib/output-path.ts`를 그대로 복사하지 말 것. Reason: `process.cwd()/output` 가정을 가진다 — `STORAGE_ROOT/out` 기준으로 다시 써야 한다(D2).
- **Don't** `resolveStoragePath`에 legacy 절대경로 통과 분기를 추가하지 말 것. Reason: 메일 첨부 exfiltration 경로가 된다(I4). 절대경로 정규화는 런타임이 아니라 후속 일회성 마이그레이션의 책임(spec §13).
- **Don't** `STORAGE_ROOT`를 env 스키마에서 required로 만들지 말 것. Reason: DB·스토리지 없는 CI(`lint`/`build`/`test`)가 깨진다(CLAUDE.md). fail-closed는 사용 시점에.
