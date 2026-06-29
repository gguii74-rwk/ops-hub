# Task 04 — 설정 CRUD service + API

**Purpose:** `BillingConfig`/`BillingRoundDate` CRUD service(권한 게이트 + BigInt→Number DTO 경계)와 8개 API 핸들러를 신설한다. day-sync 봉투(`{success,…}`) 제거, `auth()`→권한 게이트→`mapError` 표준(spec §6.3·§6.4, D5).

## Files

- **Create:** `src/modules/workflows/services/billing-config.ts`
- **Create:** `src/app/api/workflows/billing/config/route.ts` — GET 목록·POST 생성
- **Create:** `src/app/api/workflows/billing/config/[year]/route.ts` — GET·PATCH·DELETE
- **Create:** `src/app/api/workflows/billing/config/[year]/rounds/route.ts` — GET
- **Create:** `src/app/api/workflows/billing/config/[year]/rounds/[round]/route.ts` — PUT·DELETE
- **Create (test):** `tests/modules/workflows/billing-config-service.test.ts`

## Prep

- 읽기: spec §6.3·§6.4, entrypoint §Shared Contracts SC-6·SC-9.
- 참조: `src/app/api/workflows/[id]/cancel/route.ts`(라우트 표준: auth→summary→ctx→service→json), `src/app/api/workflows/_shared.ts`(`mapError`, `buildTransitionCtx`), day-sync `services/billing-config.service.ts`(클래스 → 함수).
- 재사용: `buildTransitionCtx(session.user, summary)`는 `{userId,isOwner,permissionKeys,note}`를 반환한다. service의 `BillingConfigCtx = {isOwner,permissionKeys}`는 그 부분집합이라 **구조적으로 그대로 넘길 수 있다**(새 ctx 빌더 불필요).

## Deps

03(validations·repositories).

## TDD steps

### 1. 실패 테스트 작성 — `tests/modules/workflows/billing-config-service.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/repositories/billing", () => ({
  findAllBillingConfig: vi.fn(), findBillingConfigByYear: vi.fn(), createBillingConfig: vi.fn(),
  updateBillingConfigByYear: vi.fn(), deleteBillingConfigByYear: vi.fn(),
  findRoundDatesByYear: vi.fn(), findRoundDate: vi.fn(), upsertRoundDate: vi.fn(), deleteRoundDate: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import * as repo from "@/modules/workflows/repositories/billing";
import {
  listBillingConfig, getBillingConfig, createBillingConfig, updateBillingConfig,
  removeBillingConfig, listRoundDates, saveRoundDate, removeRoundDate,
} from "@/modules/workflows/services/billing-config";

const r = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ctx = (keys: string[], isOwner = false) => ({ isOwner, permissionKeys: new Set(keys) });
const row = {
  id: "c1", year: 2026, projectName: "사업", contractNumber: "R25", contractAmount: 1675080000n,
  monthlyAmount: 139590000n, contractAmountKor: "금...", monthlyAmountKor: "금...",
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
};

beforeEach(() => { Object.values(r).forEach((f) => f.mockReset()); });

describe("billing-config service 권한·DTO", () => {
  it("view 없으면 Forbidden", async () => {
    await expect(listBillingConfig(ctx([]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("list: BigInt→Number DTO(D5)", async () => {
    r.findAllBillingConfig.mockResolvedValue([row]);
    const out = await listBillingConfig(ctx(["workflows.billing:view"]));
    expect(out[0].contractAmount).toBe(1675080000);
    expect(typeof out[0].contractAmount).toBe("number");
    expect(out[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
  it("OWNER는 권한키 없이도 통과", async () => {
    r.findAllBillingConfig.mockResolvedValue([]);
    await expect(listBillingConfig(ctx([], true))).resolves.toEqual([]);
  });
  it("get: 없으면 null(라우트 404)", async () => {
    r.findBillingConfigByYear.mockResolvedValue(null);
    expect(await getBillingConfig(ctx(["workflows.billing:view"]), 2099)).toBeNull();
  });
  it("create: configure 없으면 Forbidden", async () => {
    await expect(createBillingConfig(ctx(["workflows.billing:view"]), { year: 2026 } as never)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("create: year 중복이면 Conflict(409)", async () => {
    r.findBillingConfigByYear.mockResolvedValue(row);
    await expect(
      createBillingConfig(ctx(["workflows.billing:configure"]), { year: 2026 } as never),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(r.createBillingConfig).not.toHaveBeenCalled();
  });
  it("create: 정상 → DTO", async () => {
    r.findBillingConfigByYear.mockResolvedValue(null);
    r.createBillingConfig.mockResolvedValue(row);
    const out = await createBillingConfig(ctx(["workflows.billing:configure"]), { year: 2026 } as never);
    expect(out.year).toBe(2026);
    expect(out.monthlyAmount).toBe(139590000);
  });
  it("update: 없으면 null", async () => {
    r.findBillingConfigByYear.mockResolvedValue(null);
    expect(await updateBillingConfig(ctx(["workflows.billing:configure"]), 2099, {})).toBeNull();
    expect(r.updateBillingConfigByYear).not.toHaveBeenCalled();
  });
  it("remove: 없으면 false, 있으면 true + 연쇄 삭제 호출", async () => {
    r.findBillingConfigByYear.mockResolvedValueOnce(null);
    expect(await removeBillingConfig(ctx(["workflows.billing:configure"]), 2099)).toBe(false);
    r.findBillingConfigByYear.mockResolvedValueOnce(row);
    expect(await removeBillingConfig(ctx(["workflows.billing:configure"]), 2026)).toBe(true);
    expect(r.deleteBillingConfigByYear).toHaveBeenCalledWith(2026);
  });
  it("round: view로 목록, configure로 저장/삭제", async () => {
    r.findRoundDatesByYear.mockResolvedValue([{ id: "rd1", year: 2026, round: 2, submitDate: new Date("2026-03-10T00:00:00Z") }]);
    const list = await listRoundDates(ctx(["workflows.billing:view"]), 2026);
    expect(list[0]).toEqual({ round: 2, submitDate: "2026-03-10T00:00:00.000Z" });
    await expect(saveRoundDate(ctx(["workflows.billing:view"]), 2026, 2, new Date())).rejects.toBeInstanceOf(ForbiddenError);
    r.upsertRoundDate.mockResolvedValue({ id: "rd1", year: 2026, round: 2, submitDate: new Date("2026-03-11T00:00:00Z") });
    const saved = await saveRoundDate(ctx(["workflows.billing:configure"]), 2026, 2, new Date("2026-03-11T00:00:00Z"));
    expect(saved.round).toBe(2);
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/billing-config-service.test.ts
```

### 3. service 구현 — `src/modules/workflows/services/billing-config.ts`

```ts
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
```

### 4. 실행 → PASS

```bash
npm test -- tests/modules/workflows/billing-config-service.test.ts
```

### 5. API 라우트 구현

#### `src/app/api/workflows/billing/config/route.ts`

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { billingConfigSchema } from "@/modules/workflows/validations";
import { listBillingConfig, createBillingConfig } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const items = await listBillingConfig(buildTransitionCtx(session.user, summary));
    return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const data = billingConfigSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    const created = await createBillingConfig(buildTransitionCtx(session.user, summary), data);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}
```

#### `src/app/api/workflows/billing/config/[year]/route.ts`

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { billingConfigUpdateSchema } from "@/modules/workflows/validations";
import { getBillingConfig, updateBillingConfig, removeBillingConfig } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../../_shared";

function parseYear(raw: string): number | null {
  const y = Number(raw);
  return Number.isInteger(y) ? y : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear((await params).year);
  if (year === null) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const dto = await getBillingConfig(buildTransitionCtx(session.user, summary), year);
    if (!dto) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(dto, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear((await params).year);
  if (year === null) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const data = billingConfigUpdateSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    const dto = await updateBillingConfig(buildTransitionCtx(session.user, summary), year, data);
    if (!dto) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(dto);
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear((await params).year);
  if (year === null) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const ok = await removeBillingConfig(buildTransitionCtx(session.user, summary), year);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
```

#### `src/app/api/workflows/billing/config/[year]/rounds/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listRoundDates } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const y = Number((await params).year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const items = await listRoundDates(buildTransitionCtx(session.user, summary), y);
    return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}
```

#### `src/app/api/workflows/billing/config/[year]/rounds/[round]/route.ts`

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { billingRoundDateUpdateSchema } from "@/modules/workflows/validations";
import { saveRoundDate, removeRoundDate } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../../../../_shared";

function parsePair(yearRaw: string, roundRaw: string): { year: number; round: number } | null {
  const year = Number(yearRaw);
  const round = Number(roundRaw);
  if (!Number.isInteger(year) || !Number.isInteger(round) || round < 1 || round > 12) return null;
  return { year, round };
}

export async function PUT(req: Request, { params }: { params: Promise<{ year: string; round: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = await params;
  const pair = parsePair(p.year, p.round);
  if (!pair) return NextResponse.json({ error: "invalid year/round" }, { status: 400 });
  try {
    const { submitDate } = billingRoundDateUpdateSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    const dto = await saveRoundDate(buildTransitionCtx(session.user, summary), pair.year, pair.round, new Date(submitDate));
    return NextResponse.json(dto);
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ year: string; round: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = await params;
  const pair = parsePair(p.year, p.round);
  if (!pair) return NextResponse.json({ error: "invalid year/round" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const ok = await removeRoundDate(buildTransitionCtx(session.user, summary), pair.year, pair.round);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
```

### 6. commit

```bash
git add src/modules/workflows/services/billing-config.ts "src/app/api/workflows/billing" tests/modules/workflows/billing-config-service.test.ts
git commit -m "feat(workflows): billing 설정 CRUD service + API(권한 게이트·BigInt DTO)"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/billing-config-service.test.ts` 전건 PASS(권한·중복 409·not-found null·BigInt→Number).
- `npm run typecheck` / `npm run lint`(boundaries — 라우트는 `@/modules/workflows/services/*`·`@/kernel/access`·`@/lib/auth`만) / `npm run build` 통과.

## Cautions

- **Don't** day-sync `{success,data,message}` 봉투를 옮기지 말 것. Reason: ops-hub는 봉투 없이 payload 직접 반환 + 에러는 `mapError` HTTP 코드(spec §6.4).
- **Don't** not-found를 `ConflictError`(409)로 던지지 말 것. Reason: 없는 리소스는 404. service는 null/false 반환, 라우트가 404로 변환(getTaskDetailView 패턴).
- **Don't** `mapError`가 `ZodError`를 처리한다고 가정하지 말 것. Reason: `mapError`는 ForbiddenError/ConflictError만 매핑하고 나머지는 rethrow(500). zod 검증 실패는 라우트에서 직접 400으로 잡아야 한다.
- **Don't** DTO에서 BigInt를 그대로 `NextResponse.json`에 넘기지 말 것. Reason: `JSON.stringify`가 bigint에서 throw → 500. `Number()` 변환 필수(D5).
