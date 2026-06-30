import "server-only";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "../types";
import type { BillingConfigData, BillingConfigUpdateData } from "../validations";
import {
  findAllBillingConfig, findBillingConfigByYear, createBillingConfig as repoCreate,
  updateBillingConfigByYear, deleteBillingConfigByYear,
  findRoundDatesByYear, findRoundDate, upsertRoundDate, deleteRoundDate,
  type BillingConfigRow, type BillingRoundDateRow,
} from "../repositories/billing";

export interface BillingConfigCtx { isOwner: boolean; permissionKeys: Set<string> }

function can(ctx: BillingConfigCtx, action: string): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`workflows.billing:${action}`);
}
function requireConfigure(ctx: BillingConfigCtx) {
  if (!can(ctx, "configure")) throw new ForbiddenError("workflows.billing:configure 권한이 없습니다.");
}
function requireView(ctx: BillingConfigCtx) {
  if (!can(ctx, "view")) throw new ForbiddenError("workflows.billing:view 권한이 없습니다.");
}

// DTO: BigInt → Number (D5, JSON 직렬화 경계). 금액은 refine으로 ≤ MAX_SAFE 보장됨(task-03).
export interface BillingConfigDto {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: number; monthlyAmount: number; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: string; updatedAt: string;
}
function toConfigDto(r: BillingConfigRow): BillingConfigDto {
  return {
    id: r.id, year: r.year, projectName: r.projectName, contractNumber: r.contractNumber,
    contractAmount: Number(r.contractAmount), monthlyAmount: Number(r.monthlyAmount),
    contractAmountKor: r.contractAmountKor, monthlyAmountKor: r.monthlyAmountKor,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}
export interface RoundDateDto { round: number; submitDate: string }
function toRoundDto(r: BillingRoundDateRow): RoundDateDto {
  return { round: r.round, submitDate: r.submitDate.toISOString() };
}

export async function listBillingConfig(ctx: BillingConfigCtx): Promise<BillingConfigDto[]> {
  requireView(ctx);
  return (await findAllBillingConfig()).map(toConfigDto);
}

export async function getBillingConfig(ctx: BillingConfigCtx, year: number): Promise<BillingConfigDto | null> {
  requireView(ctx);
  const row = await findBillingConfigByYear(year);
  return row ? toConfigDto(row) : null;
}

export async function createBillingConfig(ctx: BillingConfigCtx, data: BillingConfigData): Promise<BillingConfigDto> {
  requireConfigure(ctx);
  if (await findBillingConfigByYear(data.year)) {
    throw new ConflictError(`${data.year}년 설정이 이미 존재합니다.`);
  }
  return toConfigDto(await repoCreate(data));
}

export async function updateBillingConfig(
  ctx: BillingConfigCtx, year: number, data: BillingConfigUpdateData,
): Promise<BillingConfigDto | null> {
  requireConfigure(ctx);
  if (!(await findBillingConfigByYear(year))) return null;
  return toConfigDto(await updateBillingConfigByYear(year, data));
}

export async function removeBillingConfig(ctx: BillingConfigCtx, year: number): Promise<boolean> {
  requireConfigure(ctx);
  if (!(await findBillingConfigByYear(year))) return false;
  await deleteBillingConfigByYear(year); // 회차 연쇄 삭제(repo tx)
  return true;
}

export async function listRoundDates(ctx: BillingConfigCtx, year: number): Promise<RoundDateDto[]> {
  requireView(ctx);
  return (await findRoundDatesByYear(year)).map(toRoundDto);
}

export async function saveRoundDate(
  ctx: BillingConfigCtx, year: number, round: number, submitDate: Date,
): Promise<RoundDateDto> {
  requireConfigure(ctx);
  return toRoundDto(await upsertRoundDate(year, round, submitDate));
}

export async function removeRoundDate(ctx: BillingConfigCtx, year: number, round: number): Promise<boolean> {
  requireConfigure(ctx);
  if (!(await findRoundDate(year, round))) return false;
  await deleteRoundDate(year, round);
  return true;
}
