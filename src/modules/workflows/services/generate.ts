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

// per-request finalDir는 reqId로 유일 → 사전 존재 불가. 단순 atomic rename(공유 디렉터리 clobber 없음 — R3-1).
function promoteDir(tmpDir: string, finalDir: string): void {
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });
  fs.renameSync(tmpDir, finalDir);
}

function billingRoundDate(kind: WorkflowKind, scheduledAt: Date) {
  if (kind !== "BILLING") return undefined;
  const p = computeBillingPeriod(scheduledAt);
  return { year: p.projectYear, round: p.round, submitDate: p.billingDate };
}

// 일반 kind 디스패치 generate 오케스트레이터(spec §8.2). 권한·status·직렬화·승격·commit를 조립.
export async function runGenerate(taskId: string, ctx: TransitionCtx): Promise<void> {
  const reqId = randomUUID();
  // 경로 해석을 lease 획득 전에 끝낸다(R6-3): resolveOutputPath가 throw(STORAGE_ROOT 문제 등)해도 lease가
  // 새지 않게(획득 전이라 release 불필요). 경로는 taskId·reqId의 순수 함수라 lease와 무관.
  const tmpDir = resolveOutputPath(`workflows/.tmp/${taskId}-${reqId}`);
  // per-request 커밋 경로(R3-1): 공유 out/workflows/<taskId> 대신 요청별 고유 디렉터리. stale 패배자가
  // 승자 산출물을 덮어쓸 수 없고(서로 다른 reqId 디렉터리), holder 가드 commit이 승자 경로를 DB에 기록한다.
  const finalRel = `out/workflows/${taskId}/${reqId}`;
  const finalDir = resolveOutputPath(`workflows/${taskId}/${reqId}`);
  // 0. lease 점유로 직렬화(J1). 실패면 동시 generate 진행 중 → 즉시 409(무한 대기 없음).
  if (!(await acquireGenerationLease(taskId, reqId))) {
    throw new ConflictError("이미 생성이 진행 중입니다.");
  }
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
    // 생성기가 돌려준 파일명(basename)을 per-request 커밋 경로로 재작성한다(생성기는 파일명만 의미 있음).
    const files = result.files.map((f) => ({ ...f, path: `${finalRel}/${path.posix.basename(f.path)}` }));

    // 3. 원자 승격(GENERATED는 파일 안착 후에만 — G1).
    //    승격 직전 lease 소유권 재검증: 생성이 TTL을 넘겨 steal당했으면 stale 산출물을 올리지 않는다(early-abort).
    //    per-request 경로라 승격 자체는 승자를 침범하지 않지만, 무의미한 stale 디렉터리 생성을 줄인다.
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
      outputPath: finalRel,
      files,
      roundDate: billingRoundDate(kind, task.scheduledAt),
    });
  } catch (e) {
    if (!promoted) {
      safeRm(tmpDir); // 승격 전 실패 — tmp는 미커밋·이 요청 전용.
    } else if (e instanceof ConflictError) {
      // 승격 후 known 도메인 충돌(holder/status 가드는 commit tx 내부에서 throw = 확정 롤백) → 내 orphan finalDir 정리.
      safeRm(finalDir);
    }
    // 그 외 승격 후 오류(커밋 응답 유실·커넥션 오류 등 애매)는 finalDir를 지우지 않는다(R5-1) — tx가 커밋됐을 수 있어
    // (task GENERATED + GeneratedFile rows) 파일을 지우면 복구 불가 데이터 손실. 고아는 후속 orphan cleanup에 맡기고,
    // status가 PENDING으로 남으면 재생성이 새 reqId로 복구된다(G1).
    throw e;
  } finally {
    await releaseGenerationLease(taskId, reqId);
  }
}
