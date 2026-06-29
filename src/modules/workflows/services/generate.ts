import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { WorkflowKind } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { resolveOutputPath } from "@/lib/storage";
import { ConflictError, type TransitionCtx } from "../types";
import { KIND_RESOURCE } from "../policy";
import { getGenerator } from "./generator-registry";
import { acquireGenerationLease, releaseGenerationLease, holdsGenerationLease } from "../repositories/generation-lock";
import { findTaskForGenerate, commitGeneratedTransition } from "../repositories";
import { computeBillingPeriod } from "../billing/period";

function can(ctx: TransitionCtx, resource: string, action: string): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${resource}:${action}`);
}

function safeRm(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

// 임시 디렉터리를 final로 원자 승격. 기존 final이 있으면 유니크 trash로 치운 뒤 교체(torn write 없음).
function promoteDir(tmpDir: string, finalDir: string): void {
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });
  if (fs.existsSync(finalDir)) {
    const trash = resolveOutputPath(`workflows/.trash/${path.basename(finalDir)}-${randomUUID()}`);
    fs.mkdirSync(path.dirname(trash), { recursive: true });
    fs.renameSync(finalDir, trash);  // 기존 final → trash (atomic)
    fs.renameSync(tmpDir, finalDir); // tmp → final (atomic)
    safeRm(trash);                   // trash 정리(실패해도 무해)
  } else {
    fs.renameSync(tmpDir, finalDir);
  }
}

function billingRoundDate(kind: WorkflowKind, scheduledAt: Date) {
  if (kind !== "BILLING") return undefined;
  const p = computeBillingPeriod(scheduledAt);
  return { year: p.projectYear, round: p.round, submitDate: p.billingDate };
}

// 일반 kind 디스패치 generate 오케스트레이터(spec §8.2). 권한·status·직렬화·승격·commit를 조립.
export async function runGenerate(taskId: string, ctx: TransitionCtx): Promise<void> {
  const reqId = randomUUID();
  // 0. lease 점유로 직렬화(J1). 실패면 동시 generate 진행 중 → 즉시 409(무한 대기 없음).
  if (!(await acquireGenerationLease(taskId, reqId))) {
    throw new ConflictError("이미 생성이 진행 중입니다.");
  }
  const tmpDir = resolveOutputPath(`workflows/.tmp/${taskId}-${reqId}`);
  const finalDir = resolveOutputPath(`workflows/${taskId}`);
  let promoted = false;
  try {
    // 1. task 로드 + 권한 + status. lease 덕에 승격하는 요청은 하나뿐.
    const found = await findTaskForGenerate(taskId);
    if (!found) throw new ForbiddenError("작업을 찾을 수 없습니다.");
    const { task, kind } = found;
    if (!can(ctx, KIND_RESOURCE[kind], "generate")) {
      throw new ForbiddenError(`${KIND_RESOURCE[kind]}:generate 권한이 없습니다.`);
    }
    if (task.status !== "PENDING") throw new ConflictError(`${task.status} 상태에서는 생성할 수 없습니다.`);

    // 2. 생성 — 요청별 임시 디렉터리(DB tx 밖, 순수 FS·zip). round-date는 여기서 안 건드림(I3).
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = await getGenerator(kind).generate(task, tmpDir); // 정확히 1회

    // 3. 원자 승격(GENERATED는 파일 안착 후에만 — G1).
    //    승격 직전 lease 소유권 재검증: 생성이 TTL을 넘겨 steal당했으면 stale 산출물을 final에 올리지 않는다.
    //    (cheap early-abort. 최종 권위 가드는 commit tx의 FOR UPDATE holder 검사.)
    if (!(await holdsGenerationLease(taskId, reqId))) {
      throw new ConflictError("생성 lease를 더 이상 보유하지 않습니다.");
    }
    promoteDir(tmpDir, finalDir);
    promoted = true;

    // 4. 짧은 commit tx: holder 가드 + status CAS + 파일 + 이벤트 + (billing) round-date create-if-missing.
    await commitGeneratedTransition({
      taskId,
      actorId: ctx.userId,
      holder: reqId,
      outputPath: `out/workflows/${taskId}`,
      files: result.files,
      roundDate: billingRoundDate(kind, task.scheduledAt),
    });
  } catch (e) {
    // 승격 전 실패만 tmp 정리. 승격 후 commit 실패는 final 유지(status PENDING, 재생성 복구 G1).
    if (!promoted) safeRm(tmpDir);
    throw e;
  } finally {
    await releaseGenerationLease(taskId, reqId);
  }
}
