# Task 03 — billing validations + repositories

**Purpose:** `BillingConfig`/`BillingRoundDate`의 Zod 스키마(BigInt 경계 강제 F3·J4)와 데이터 접근 함수(클래스→모듈 함수 평탄화, 삭제 연쇄를 한 tx로)를 신설한다(spec §6.1·§6.2, D5).

## Files

- **Modify:** `src/modules/workflows/validations/index.ts` — billing zod 스키마 추가(§Shared Contracts SC-5)
- **Create:** `src/modules/workflows/repositories/billing.ts` — repo 함수(§Shared Contracts SC-6)
- **Create (test):** `tests/modules/workflows/billing-validations.test.ts`

## Prep

- 읽기: spec §6.1·§6.2, entrypoint §Shared Contracts SC-5·SC-6.
- 참조: day-sync `src/lib/validations/billing-config.ts`(Zod 3, `number`)·`src/repositories/billing-config.repository.ts`·`billing-round-date.repository.ts`(클래스). ops-hub는 **Zod 4 + BigInt + 함수 export + `import "server-only"`**.
- prisma 모델은 선반영(`BillingConfig`·`BillingRoundDate`, BigInt 금액, `@@unique([year,round])`). 스키마 변경 없음.

## Deps

없음.

## TDD steps

### 1. 실패 테스트 작성 — `tests/modules/workflows/billing-validations.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { billingConfigSchema, billingConfigUpdateSchema } from "@/modules/workflows/validations";

const base = {
  year: 2026, projectName: "안전신문고 시스템 유지관리 사업", contractNumber: "R25TA0125611600",
  contractAmount: 1675080000, monthlyAmount: 139590000,
  contractAmountKor: "금일십육억칠천오백팔만원정", monthlyAmountKor: "금일억삼천구백오십구만원정",
};

describe("billingConfigSchema (F3·J4 BigInt 경계)", () => {
  it("정상 입력 → 금액이 bigint로 coerce", () => {
    const r = billingConfigSchema.parse(base);
    expect(typeof r.contractAmount).toBe("bigint");
    expect(r.contractAmount).toBe(1675080000n);
    expect(r.monthlyAmount).toBe(139590000n);
  });
  it("문자열 금액도 coerce", () => {
    const r = billingConfigSchema.parse({ ...base, contractAmount: "1675080000", monthlyAmount: "139590000" });
    expect(r.contractAmount).toBe(1675080000n);
  });
  it("음수 금액 거부", () => {
    expect(() => billingConfigSchema.parse({ ...base, contractAmount: -1 })).toThrow();
    expect(() => billingConfigSchema.parse({ ...base, monthlyAmount: 0 })).toThrow();
  });
  it("contractAmount > MAX_SAFE_INTEGER 거부(F3)", () => {
    expect(() => billingConfigSchema.parse({ ...base, contractAmount: BigInt(Number.MAX_SAFE_INTEGER) + 1n })).toThrow();
  });
  it("monthlyAmount > MAX_SAFE_INTEGER/12 거부(J4 — 12회차 누계 안전)", () => {
    const overMonthly = BigInt(Number.MAX_SAFE_INTEGER) / 12n + 1n;
    expect(() => billingConfigSchema.parse({ ...base, monthlyAmount: overMonthly })).toThrow();
  });
  it("연도 범위 밖 거부", () => {
    expect(() => billingConfigSchema.parse({ ...base, year: 2019 })).toThrow();
    expect(() => billingConfigSchema.parse({ ...base, year: 2101 })).toThrow();
  });
  it("빈 문자열 필드 거부", () => {
    expect(() => billingConfigSchema.parse({ ...base, projectName: "" })).toThrow();
    expect(() => billingConfigSchema.parse({ ...base, contractAmountKor: "" })).toThrow();
  });
  it("update 스키마는 year omit + partial", () => {
    const r = billingConfigUpdateSchema.parse({ monthlyAmount: 200000000 });
    expect(r.monthlyAmount).toBe(200000000n);
    expect("year" in r).toBe(false);
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/billing-validations.test.ts
```

### 3. 스키마 구현 — `src/modules/workflows/validations/index.ts`

파일 맨 끝에 추가:

```ts
// --- billing (대금청구) ---
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MONTHLY = MAX_SAFE / 12n; // J4: 12회차 누계 monthlyAmount*12도 안전정수 내

export const billingConfigSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  projectName: z.string().min(1),
  contractNumber: z.string().min(1),
  contractAmount: z.coerce.bigint().positive().refine((v) => v <= MAX_SAFE, "계약금액이 너무 큽니다."),       // F3
  monthlyAmount: z.coerce.bigint().positive().refine((v) => v <= MAX_MONTHLY, "월 청구금액이 너무 큽니다."),  // J4
  contractAmountKor: z.string().min(1),
  monthlyAmountKor: z.string().min(1),
});
export const billingConfigUpdateSchema = billingConfigSchema.partial().omit({ year: true });
export const billingRoundDateUpdateSchema = z.object({ submitDate: z.string().datetime() });

export type BillingConfigData = z.infer<typeof billingConfigSchema>;             // 금액은 bigint
export type BillingConfigUpdateData = z.infer<typeof billingConfigUpdateSchema>;
export type BillingRoundDateUpdateData = z.infer<typeof billingRoundDateUpdateSchema>;
```

### 4. 실행 → PASS

```bash
npm test -- tests/modules/workflows/billing-validations.test.ts
```

### 5. repo 구현 — `src/modules/workflows/repositories/billing.ts`

```ts
import "server-only";
import { prisma, type PrismaTx } from "@/lib/prisma";
import type { BillingConfigData, BillingConfigUpdateData } from "../validations";

export interface BillingConfigRow {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: bigint; monthlyAmount: bigint; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: Date; updatedAt: Date;
}
export interface BillingRoundDateRow { id: string; year: number; round: number; submitDate: Date; }

export async function findAllBillingConfig(): Promise<BillingConfigRow[]> {
  return prisma.billingConfig.findMany({ orderBy: { year: "desc" } });
}

export async function findBillingConfigByYear(year: number): Promise<BillingConfigRow | null> {
  return prisma.billingConfig.findUnique({ where: { year } });
}

export async function createBillingConfig(data: BillingConfigData): Promise<BillingConfigRow> {
  return prisma.billingConfig.create({ data });
}

export async function updateBillingConfigByYear(year: number, data: BillingConfigUpdateData): Promise<BillingConfigRow> {
  return prisma.billingConfig.update({ where: { year }, data });
}

// 회차 연쇄 삭제를 한 트랜잭션으로(day-sync는 순차 await였으나 ops-hub는 원자, spec §6.2).
export async function deleteBillingConfigByYear(year: number): Promise<void> {
  await prisma.$transaction(async (tx: PrismaTx) => {
    await tx.billingRoundDate.deleteMany({ where: { year } });
    await tx.billingConfig.delete({ where: { year } });
  });
}

export async function findRoundDatesByYear(year: number): Promise<BillingRoundDateRow[]> {
  return prisma.billingRoundDate.findMany({
    where: { year }, orderBy: { round: "asc" },
    select: { id: true, year: true, round: true, submitDate: true },
  });
}

export async function findRoundDate(year: number, round: number): Promise<BillingRoundDateRow | null> {
  return prisma.billingRoundDate.findUnique({
    where: { year_round: { year, round } },
    select: { id: true, year: true, round: true, submitDate: true },
  });
}

export async function upsertRoundDate(year: number, round: number, submitDate: Date): Promise<BillingRoundDateRow> {
  return prisma.billingRoundDate.upsert({
    where: { year_round: { year, round } },
    update: { submitDate },
    create: { year, round, submitDate },
    select: { id: true, year: true, round: true, submitDate: true },
  });
}

export async function deleteRoundDate(year: number, round: number): Promise<void> {
  await prisma.billingRoundDate.delete({ where: { year_round: { year, round } } });
}
```

### 6. commit

```bash
git add src/modules/workflows/validations/index.ts src/modules/workflows/repositories/billing.ts tests/modules/workflows/billing-validations.test.ts
git commit -m "feat(workflows): billing config/roundDate validations(BigInt 경계) + repositories"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/billing-validations.test.ts` 전건 PASS.
- `npm run typecheck`(repo 반환 타입이 prisma 모델과 호환) / `npm run lint`(boundaries — repo는 `@/lib/prisma`만 import) / `npm run build` 통과.

## Cautions

- **Don't** 금액을 `z.number()`로 받지 말 것. Reason: DB는 BigInt이고 큰 금액이 `JSON.stringify`/`Number()` 경계에서 조용히 변조된다(D5). `z.coerce.bigint()` + refine으로 강제.
- **Don't** 삭제를 순차 `await`(회차 삭제 → config 삭제)로 두지 말 것. Reason: 중간 실패 시 회차만 지워진 고아 상태. `$transaction`으로 원자화.
- **Don't** repo에서 BigInt를 `Number()`로 변환하지 말 것. Reason: repo는 BigInt 그대로 유지하고 변환은 service의 DTO 경계에서만(task-04, D5).
