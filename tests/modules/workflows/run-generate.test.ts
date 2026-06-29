import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "req-1") }));
vi.mock("node:fs", () => ({ default: { mkdirSync: vi.fn(), existsSync: vi.fn(() => false), renameSync: vi.fn(), rmSync: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ resolveOutputPath: vi.fn((rel: string) => `/abs/${rel}`) }));
vi.mock("@/modules/workflows/repositories/generation-lock", () => ({ acquireGenerationLease: vi.fn(), releaseGenerationLease: vi.fn(), holdsGenerationLease: vi.fn() }));
vi.mock("@/modules/workflows/repositories", () => ({ findTaskForGenerate: vi.fn(), commitGeneratedTransition: vi.fn() }));
vi.mock("@/modules/workflows/services/generator-registry", () => ({ getGenerator: vi.fn() }));

import fs from "node:fs";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import { acquireGenerationLease, releaseGenerationLease, holdsGenerationLease } from "@/modules/workflows/repositories/generation-lock";
import { findTaskForGenerate, commitGeneratedTransition } from "@/modules/workflows/repositories";
import { getGenerator } from "@/modules/workflows/services/generator-registry";
import { runGenerate } from "@/modules/workflows/services/generate";

const acquire = acquireGenerationLease as unknown as ReturnType<typeof vi.fn>;
const release = releaseGenerationLease as unknown as ReturnType<typeof vi.fn>;
const holds = holdsGenerationLease as unknown as ReturnType<typeof vi.fn>;
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
  [acquire, release, holds, findTask, commit, getGen, fsRename, fsRm].forEach((f) => f.mockReset());
  fsExists.mockReset().mockReturnValue(false);
  acquire.mockResolvedValue(true);
  holds.mockResolvedValue(true);
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
  it("정상: generate → per-request 승격(rename) → commit(per-request 경로·billing roundDate) → release", async () => {
    await runGenerate("t1", ctx(["workflows.billing:generate"]));
    expect(gen.generate).toHaveBeenCalledWith(billingTask, "/abs/workflows/.tmp/t1-req-1");
    // per-request finalDir: out/workflows/<taskId>/<reqId> (R3-1)
    expect(fsRename).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", "/abs/workflows/t1/req-1");
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "t1", outputPath: "out/workflows/t1/req-1", holder: "req-1",
      files: [{ path: "out/workflows/t1/req-1/a.hwpx", displayName: "a.hwpx" }], // basename을 per-request 경로로 재작성
      roundDate: { year: 2026, round: 2, submitDate: billingTask.scheduledAt }, // KST 3/10 → 전월 2월
    }));
    expect(release).toHaveBeenCalledWith("t1", "req-1");
  });

  it("승격 직전 lease steal(holdsGenerationLease=false) → Conflict, promote(rename)·commit 미수행(R1-2)", async () => {
    holds.mockResolvedValue(false); // 생성 도중 steal당함
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toBeInstanceOf(ConflictError);
    expect(fsRename).not.toHaveBeenCalled(); // stale 산출물을 final에 올리지 않음
    expect(commit).not.toHaveBeenCalled();
    expect(fsRm).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", { recursive: true, force: true }); // tmp 정리
    expect(release).toHaveBeenCalledWith("t1", "req-1");
  });
  it("per-request 승격은 단일 rename(공유 디렉터리 trash-swap 없음 — R3-1)", async () => {
    await runGenerate("t1", ctx(["workflows.billing:generate"]));
    expect(fsRename).toHaveBeenCalledTimes(1); // reqId로 유일한 finalDir → 사전 존재 없음, clobber 없음
    expect(fsRm).not.toHaveBeenCalled();
  });
  it("generate 실패 → tmp cleanup + 에러 전파 + release(commit 미호출)", async () => {
    gen.generate.mockRejectedValue(new Error("zip fail"));
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toThrow("zip fail");
    expect(fsRm).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", { recursive: true, force: true });
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("승격 후 commit이 ConflictError(확정 롤백) → finalDir orphan 정리(R5-1)", async () => {
    commit.mockRejectedValue(new ConflictError());
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toBeInstanceOf(ConflictError);
    expect(fsRm).toHaveBeenCalledWith("/abs/workflows/t1/req-1", { recursive: true, force: true });
  });

  it("승격 후 commit이 애매한 오류(비-ConflictError) → finalDir 보존(데이터 손실 차단, R5-1)", async () => {
    commit.mockRejectedValue(new Error("connection lost after commit"));
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toThrow("connection lost");
    // 커밋됐을 수 있으므로 파일을 지우지 않는다 — tmp도 finalDir도 rm 호출 없음(이미 승격됨).
    expect(fsRm).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
  it("non-billing kind는 roundDate 없이 commit", async () => {
    findTask.mockResolvedValue({ task: { id: "t2", status: "PENDING", scheduledAt: new Date() }, kind: "WEEKLY_REPORT" });
    await runGenerate("t2", ctx(["workflows.weekly:generate"]));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ roundDate: undefined }));
  });
});
