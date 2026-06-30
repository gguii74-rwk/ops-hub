# Task 11 — 다운로드 API (단일 파일 + 디렉터리 ZIP)

**Purpose:** 생성 산출물 다운로드를 신설한다 — `GeneratedFile.id` 조회(raw path 금지)·`outputPath` 디렉터리 ZIP, 둘 다 strict resolver만 사용해 절대경로/`..` row를 거부한다(spec §10, D13·F4).

## Files

- **Modify:** `src/modules/workflows/repositories/index.ts` — `findGeneratedFileForDownload`·`findTaskForDownload`
- **Create:** `src/modules/workflows/services/download.ts`
- **Create:** `src/app/api/workflows/[id]/files/[fileId]/route.ts`
- **Create:** `src/app/api/workflows/[id]/download/route.ts`
- **Create (test):** `tests/modules/workflows/download-service.test.ts`

## Prep

- 읽기: spec §10, entrypoint §Shared Contracts SC-1·SC-2·SC-9.
- 의존: task-01(`resolveStoragePath` strict). billing `outputPath`는 디렉터리(D3).
- 핵심: `file.path`/`outputPath`가 절대경로/`..`면(마이그레이션·운영 수정으로 유입돼도) **strict resolve가 throw → 다운로드 거부**(service에서 catch → null → 404). 다운로드 경계는 strict만(legacy 통과 없음, F4).

## Deps

01.

## TDD steps

### 1. repo 추가 — `src/modules/workflows/repositories/index.ts`

파일 끝에 추가:

```ts
export interface GeneratedFileForDownload {
  id: string; taskId: string; path: string; displayName: string; mimeType: string | null; kind: WorkflowKind;
}
export async function findGeneratedFileForDownload(fileId: string): Promise<GeneratedFileForDownload | null> {
  const f = await prisma.generatedFile.findUnique({
    where: { id: fileId },
    select: { id: true, taskId: true, path: true, displayName: true, mimeType: true, task: { select: { type: { select: { kind: true } } } } },
  });
  if (!f) return null;
  return { id: f.id, taskId: f.taskId, path: f.path, displayName: f.displayName, mimeType: f.mimeType, kind: f.task.type.kind };
}

export interface TaskForDownload { outputPath: string | null; kind: WorkflowKind; }
export async function findTaskForDownload(id: string): Promise<TaskForDownload | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: { outputPath: true, type: { select: { kind: true } } },
  });
  if (!t) return null;
  return { outputPath: t.outputPath, kind: t.type.kind };
}
```

### 2. 실패 테스트 작성 — `tests/modules/workflows/download-service.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(), statSync: vi.fn(), readFileSync: vi.fn(), readdirSync: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  resolveStoragePath: vi.fn((p: string) => { if (p.startsWith("out/")) return `/abs/${p}`; throw new Error("strict: 거부"); }),
}));
vi.mock("@/modules/workflows/repositories", () => ({ findGeneratedFileForDownload: vi.fn(), findTaskForDownload: vi.fn() }));

import fs from "node:fs";
import { ForbiddenError } from "@/kernel/access";
import { findGeneratedFileForDownload, findTaskForDownload } from "@/modules/workflows/repositories";
import { getFileForDownload, getDirectoryZip } from "@/modules/workflows/services/download";

const findFile = findGeneratedFileForDownload as unknown as ReturnType<typeof vi.fn>;
const findTask = findTaskForDownload as unknown as ReturnType<typeof vi.fn>;
const existsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>;
const statSync = fs.statSync as unknown as ReturnType<typeof vi.fn>;
const readFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>;
const readdirSync = fs.readdirSync as unknown as ReturnType<typeof vi.fn>;
const ctx = (keys: string[]) => ({ isOwner: false, permissionKeys: new Set(keys) });
const fileRow = { id: "f1", taskId: "t1", path: "out/workflows/t1/a.hwpx", displayName: "공문.hwpx", mimeType: "application/octet-stream", kind: "BILLING" };

beforeEach(() => {
  [findFile, findTask, existsSync, statSync, readFileSync, readdirSync].forEach((f) => f.mockReset());
});

describe("getFileForDownload (D13·F4)", () => {
  it("파일 없음 → null(404)", async () => {
    findFile.mockResolvedValue(null);
    expect(await getFileForDownload(ctx(["workflows.billing:view"]), "t1", "f1")).toBeNull();
  });
  it("taskId 불일치 → null", async () => {
    findFile.mockResolvedValue({ ...fileRow, taskId: "other" });
    expect(await getFileForDownload(ctx(["workflows.billing:view"]), "t1", "f1")).toBeNull();
  });
  it("view 권한 없음 → Forbidden", async () => {
    findFile.mockResolvedValue(fileRow);
    await expect(getFileForDownload(ctx([]), "t1", "f1")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("절대경로 row → 다운로드 거부(null, F4)", async () => {
    findFile.mockResolvedValue({ ...fileRow, path: "/etc/passwd" });
    expect(await getFileForDownload(ctx(["workflows.billing:view"]), "t1", "f1")).toBeNull();
  });
  it("정상 → bytes/filename/mime", async () => {
    findFile.mockResolvedValue(fileRow);
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isFile: () => true });
    readFileSync.mockReturnValue(Buffer.from("hwpx-bytes"));
    const out = await getFileForDownload(ctx(["workflows.billing:view"]), "t1", "f1");
    expect(out?.filename).toBe("공문.hwpx");
    expect(out?.mimeType).toBe("application/octet-stream");
    expect(out?.bytes).toBeInstanceOf(Uint8Array);
  });
});

describe("getDirectoryZip (D13·F4)", () => {
  it("outputPath 없음 → null", async () => {
    findTask.mockResolvedValue({ outputPath: null, kind: "BILLING" });
    expect(await getDirectoryZip(ctx(["workflows.billing:view"]), "t1")).toBeNull();
  });
  it("권한 없음 → Forbidden", async () => {
    findTask.mockResolvedValue({ outputPath: "out/workflows/t1", kind: "BILLING" });
    await expect(getDirectoryZip(ctx([]), "t1")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("절대경로 outputPath → 거부(null, F4)", async () => {
    findTask.mockResolvedValue({ outputPath: "/srv/x", kind: "BILLING" });
    expect(await getDirectoryZip(ctx(["workflows.billing:view"]), "t1")).toBeNull();
  });
  it("정상 → zip bytes", async () => {
    findTask.mockResolvedValue({ outputPath: "out/workflows/t1", kind: "BILLING" });
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isDirectory: () => true, isFile: () => true });
    readdirSync.mockReturnValue(["a.hwpx", "b.hwpx"]);
    readFileSync.mockReturnValue(Buffer.from("x"));
    const out = await getDirectoryZip(ctx(["workflows.billing:view"]), "t1");
    expect(out?.filename).toBe("t1.zip");
    expect(out?.bytes).toBeInstanceOf(Uint8Array);
    expect(out!.bytes.length).toBeGreaterThan(0);
  });
});
```

### 3. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/download-service.test.ts
```

### 4. service 구현 — `src/modules/workflows/services/download.ts`

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { ForbiddenError } from "@/kernel/access";
import { resolveStoragePath } from "@/lib/storage";
import { KIND_RESOURCE } from "../policy";
import { findGeneratedFileForDownload, findTaskForDownload } from "../repositories";

interface DownloadCtx { isOwner: boolean; permissionKeys: Set<string>; }
function canView(ctx: DownloadCtx, kind: import("@prisma/client").WorkflowKind): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${KIND_RESOURCE[kind]}:view`);
}

export interface FileDownload { bytes: Uint8Array; filename: string; mimeType: string; }

export async function getFileForDownload(ctx: DownloadCtx, taskId: string, fileId: string): Promise<FileDownload | null> {
  const f = await findGeneratedFileForDownload(fileId);
  if (!f || f.taskId !== taskId) return null; // raw path 금지 — id로만 조회(D13)
  if (!canView(ctx, f.kind)) throw new ForbiddenError("열람 권한이 없습니다.");
  let abs: string;
  try {
    abs = resolveStoragePath(f.path); // strict — 절대경로/.. row면 throw → 다운로드 거부(F4)
  } catch {
    return null;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return {
    bytes: new Uint8Array(fs.readFileSync(abs)),
    filename: f.displayName,
    mimeType: f.mimeType ?? "application/octet-stream",
  };
}

export interface ZipDownload { bytes: Uint8Array; filename: string; }

export async function getDirectoryZip(ctx: DownloadCtx, taskId: string): Promise<ZipDownload | null> {
  const t = await findTaskForDownload(taskId);
  if (!t || !t.outputPath) return null;
  if (!canView(ctx, t.kind)) throw new ForbiddenError("열람 권한이 없습니다.");
  let absDir: string;
  try {
    absDir = resolveStoragePath(t.outputPath); // strict(F4)
  } catch {
    return null;
  }
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return null;
  const zip = new JSZip();
  for (const name of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    if (fs.statSync(abs).isFile()) zip.file(name, fs.readFileSync(abs));
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return { bytes: new Uint8Array(buf), filename: `${taskId}.zip` };
}
```

### 5. 실행 → PASS

```bash
npm test -- tests/modules/workflows/download-service.test.ts
```

### 6. 라우트 — `src/app/api/workflows/[id]/files/[fileId]/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getFileForDownload } from "@/modules/workflows/services/download";
import { buildTransitionCtx, mapError } from "../../../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, fileId } = await params;
  try {
    const summary = await getPermissionSummary(session.user.id);
    const file = await getFileForDownload(buildTransitionCtx(session.user, summary), id, fileId);
    if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(file.bytes, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) { return mapError(e); }
}
```

### 7. 라우트 — `src/app/api/workflows/[id]/download/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getDirectoryZip } from "@/modules/workflows/services/download";
import { buildTransitionCtx, mapError } from "../../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const summary = await getPermissionSummary(session.user.id);
    const zip = await getDirectoryZip(buildTransitionCtx(session.user, summary), id);
    if (!zip) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(zip.bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zip.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) { return mapError(e); }
}
```

### 8. commit

```bash
git add src/modules/workflows/repositories/index.ts src/modules/workflows/services/download.ts "src/app/api/workflows/[id]/files" "src/app/api/workflows/[id]/download" tests/modules/workflows/download-service.test.ts
git commit -m "feat(workflows): 다운로드 API(파일·디렉터리 ZIP, strict resolver D13·F4)"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/download-service.test.ts` 전건 PASS — not-found·소속 불일치·권한·절대경로 거부·정상 파일/ZIP.
- `npm run typecheck` / `npm run lint`(boundaries) / `npm test`(전체) / `npm run build` 통과.
- 절대경로/`..` row 거부가 테스트로 보장(F4 AC).

## Cautions

- **Don't** raw query string의 path로 파일을 읽지 말 것. Reason: 경로 주입. `GeneratedFile.id`로 조회 후 그 row의 `path`만 strict resolve(D13).
- **Don't** 다운로드에 legacy 절대경로 통과를 허용하지 말 것. Reason: F4 — 다운로드 경계는 strict만. 절대경로 row는 throw → catch → 404 거부.
- **Don't** `JSZip.generateAsync` 결과 `Buffer`를 그대로 `NextResponse`에 넘기지 말 것. Reason: `new Uint8Array(buf)`로 감싼다(D13 — Buffer 직접 전달 시 런타임/타입 이슈).
- **Don't** ZIP에 하위 디렉터리를 재귀로 넣지 말 것. Reason: billing outputPath는 평면 디렉터리(파일만). `statSync(abs).isFile()`만 추가 — 불필요한 재귀·심링크 추적 방지.
