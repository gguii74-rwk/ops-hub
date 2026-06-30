import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:fs", () => {
  const existsSync = vi.fn();
  const statSync = vi.fn();
  const readFileSync = vi.fn();
  const readdirSync = vi.fn();
  return { default: { existsSync, statSync, readFileSync, readdirSync }, existsSync, statSync, readFileSync, readdirSync };
});
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
