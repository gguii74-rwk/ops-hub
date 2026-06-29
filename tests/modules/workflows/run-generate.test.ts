import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "req-1") }));
vi.mock("node:fs", () => ({ default: { mkdirSync: vi.fn(), existsSync: vi.fn(() => false), renameSync: vi.fn(), rmSync: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ resolveOutputPath: vi.fn((rel: string) => `/abs/${rel}`) }));
vi.mock("@/modules/workflows/repositories/generation-lock", () => ({ acquireGenerationLease: vi.fn(), releaseGenerationLease: vi.fn() }));
vi.mock("@/modules/workflows/repositories", () => ({ findTaskForGenerate: vi.fn(), commitGeneratedTransition: vi.fn() }));
vi.mock("@/modules/workflows/services/generator-registry", () => ({ getGenerator: vi.fn() }));

import fs from "node:fs";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import { acquireGenerationLease, releaseGenerationLease } from "@/modules/workflows/repositories/generation-lock";
import { findTaskForGenerate, commitGeneratedTransition } from "@/modules/workflows/repositories";
import { getGenerator } from "@/modules/workflows/services/generator-registry";
import { runGenerate } from "@/modules/workflows/services/generate";

const acquire = acquireGenerationLease as unknown as ReturnType<typeof vi.fn>;
const release = releaseGenerationLease as unknown as ReturnType<typeof vi.fn>;
const findTask = findTaskForGenerate as unknown as ReturnType<typeof vi.fn>;
const commit = commitGeneratedTransition as unknown as ReturnType<typeof vi.fn>;
const getGen = getGenerator as unknown as ReturnType<typeof vi.fn>;
const fsRename = fs.renameSync as unknown as ReturnType<typeof vi.fn>;
const fsRm = fs.rmSync as unknown as ReturnType<typeof vi.fn>;
const fsExists = fs.existsSync as unknown as ReturnType<typeof vi.fn>;

const ctx = (keys: string[], isOwner = false) => ({ userId: "u1", isOwner, permissionKeys: new Set(keys) });
const billingTask = { id: "t1", status: "PENDING", scheduledAt: new Date("2026-03-10T01:00:00Z") };
const gen = { generate: vi.fn(async () => ({ files: [{ path: "out/workflows/t1/a.hwpx", displayName: "a.hwpx" }] })) };

beforeEach(() => {
  [acquire, release, findTask, commit, getGen, fsRename, fsRm].forEach((f) => f.mockReset());
  fsExists.mockReset().mockReturnValue(false);
  acquire.mockResolvedValue(true);
  findTask.mockResolvedValue({ task: billingTask, kind: "BILLING" });
  getGen.mockReturnValue(gen);
  gen.generate.mockClear().mockResolvedValue({ files: [{ path: "out/workflows/t1/a.hwpx", displayName: "a.hwpx" }] });
  commit.mockResolvedValue(undefined);
});

describe("runGenerate (F1·G1·H2·I2·I3·J1)", () => {
  it("lease 실패 → 409(ConflictError), generator 미호출", async () => {
    acquire.mockResolvedValue(false);
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toBeInstanceOf(ConflictError);
    expect(getGen).not.toHaveBeenCalled();
  });
  it("동시 2건: 1진행·1 409(lease가 직렬화) — spec §8.2 AC", async () => {
    acquire.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const [a, b] = await Promise.allSettled([
      runGenerate("t1", ctx(["workflows.billing:generate"])),
      runGenerate("t1", ctx(["workflows.billing:generate"])),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["fulfilled", "rejected"]);
  });
  it("권한 없으면 Forbidden + lease release", async () => {
    await expect(runGenerate("t1", ctx(["workflows.billing:view"]))).rejects.toBeInstanceOf(ForbiddenError);
    expect(release).toHaveBeenCalledWith("t1", "req-1");
  });
  it("status != PENDING → Conflict", async () => {
    findTask.mockResolvedValue({ task: { ...billingTask, status: "GENERATED" }, kind: "BILLING" });
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("정상: generate → 승격(rename) → commit(billing roundDate 포함) → release", async () => {
    await runGenerate("t1", ctx(["workflows.billing:generate"]));
    expect(gen.generate).toHaveBeenCalledWith(billingTask, "/abs/workflows/.tmp/t1-req-1");
    expect(fsRename).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", "/abs/workflows/t1");
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "t1", outputPath: "out/workflows/t1",
      roundDate: { year: 2026, round: 2, submitDate: billingTask.scheduledAt }, // KST 3/10 → 전월 2월
    }));
    expect(release).toHaveBeenCalledWith("t1", "req-1");
  });
  it("기존 final 있으면 trash 경유 원자 교체(rename 2회 + trash rm)", async () => {
    fsExists.mockReturnValue(true);
    await runGenerate("t1", ctx(["workflows.billing:generate"]));
    expect(fsRename).toHaveBeenCalledTimes(2);
    expect(fsRm).toHaveBeenCalled(); // trash 삭제
  });
  it("generate 실패 → tmp cleanup + 에러 전파 + release(commit 미호출)", async () => {
    gen.generate.mockRejectedValue(new Error("zip fail"));
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toThrow("zip fail");
    expect(fsRm).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", { recursive: true, force: true });
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
  it("non-billing kind는 roundDate 없이 commit", async () => {
    findTask.mockResolvedValue({ task: { id: "t2", status: "PENDING", scheduledAt: new Date() }, kind: "WEEKLY_REPORT" });
    await runGenerate("t2", ctx(["workflows.weekly:generate"]));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ roundDate: undefined }));
  });
});
