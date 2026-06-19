# Task 02 — policy·types·ConflictError (정책 데이터 + 포트)

전이 정책 데이터(`policy.ts`)와 모듈 공통 타입·에러(`types.ts`)를 만든다. 둘 다 순수 TS(런타임 의존 없음)라 schema·repo와 독립이다.

## Files

- Create: `src/modules/workflows/types.ts`
- Create: `src/modules/workflows/policy.ts`
- Create (test): `tests/modules/workflows/policy.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-2**(types.ts 전체), **SC-3**(policy.ts 전체).
- Spec §5.1(정책 데이터), §5.2(엔진 절차 — 정책 소비 방식).

## Deps

없음.

## Step 1 — 실패 테스트

생성: `tests/modules/workflows/policy.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { TRANSITIONS, KIND_RESOURCE, ACTION_FOR_STATUS, STAMP_FOR_STATUS } from "@/modules/workflows/policy";
import { ConflictError } from "@/modules/workflows/types";

describe("TRANSITIONS (fail-closed)", () => {
  it("3개 kind를 모두 정의한다", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(["BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT"]);
  });

  it("WEEKLY_REPORT은 PENDING→GENERATED/CANCELLED만 허용(직접 SENT 불가)", () => {
    expect(TRANSITIONS.WEEKLY_REPORT.PENDING).toEqual(["GENERATED", "CANCELLED"]);
    expect(TRANSITIONS.WEEKLY_REPORT.PENDING).not.toContain("SENT");
  });

  it("모든 kind는 PENDING에서 CANCELLED로 갈 수 있다", () => {
    for (const kind of Object.keys(TRANSITIONS) as Array<keyof typeof TRANSITIONS>) {
      expect(TRANSITIONS[kind].PENDING).toContain("CANCELLED");
    }
  });

  it("NOTIFICATION_BILLING만 GENERATED→REVIEWED를 허용한다", () => {
    expect(TRANSITIONS.NOTIFICATION_BILLING.GENERATED).toContain("REVIEWED");
    expect(TRANSITIONS.WEEKLY_REPORT.GENERATED ?? []).not.toContain("REVIEWED");
  });

  it("BILLING은 SENT→HQ_REQUESTED→FINAL_SENT 사슬을 가진다", () => {
    expect(TRANSITIONS.BILLING.SENT).toEqual(["HQ_REQUESTED"]);
    expect(TRANSITIONS.BILLING.HQ_REQUESTED).toEqual(["FINAL_SENT"]);
  });
});

describe("권한·stamp 매핑", () => {
  it("KIND_RESOURCE", () => {
    expect(KIND_RESOURCE.WEEKLY_REPORT).toBe("workflows.weekly");
    expect(KIND_RESOURCE.BILLING).toBe("workflows.billing");
    expect(KIND_RESOURCE.NOTIFICATION_BILLING).toBe("workflows.notification");
  });

  it("ACTION_FOR_STATUS", () => {
    expect(ACTION_FOR_STATUS.GENERATED).toBe("generate");
    expect(ACTION_FOR_STATUS.REVIEWED).toBe("review");
    expect(ACTION_FOR_STATUS.SENT).toBe("send");
    expect(ACTION_FOR_STATUS.HQ_REQUESTED).toBe("send");
    expect(ACTION_FOR_STATUS.FINAL_SENT).toBe("send");
    expect(ACTION_FOR_STATUS.CANCELLED).toBe("view");
  });

  it("STAMP_FOR_STATUS는 GENERATED/REVIEWED/SENT만 컬럼을 매핑", () => {
    expect(STAMP_FOR_STATUS.GENERATED).toBe("generatedAt");
    expect(STAMP_FOR_STATUS.REVIEWED).toBe("reviewedAt");
    expect(STAMP_FOR_STATUS.SENT).toBe("sentAt");
    expect(STAMP_FOR_STATUS.HQ_REQUESTED).toBeUndefined();
    expect(STAMP_FOR_STATUS.CANCELLED).toBeUndefined();
  });
});

describe("ConflictError", () => {
  it("name이 ConflictError이고 Error를 상속한다", () => {
    const e = new ConflictError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ConflictError");
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/modules/workflows/policy.test.ts
```

기대: 모듈 미존재로 import 실패.

## Step 3 — types.ts 구현

생성: `src/modules/workflows/types.ts`

```ts
import type { WorkflowKind, WorkflowStatus, WorkflowTask } from "@prisma/client";

/** 조건부 업데이트 경합·멱등 가드 위반 → API 409. */
export class ConflictError extends Error {
  constructor(message = "상태가 이미 변경되었습니다.") {
    super(message);
    this.name = "ConflictError";
  }
}

/** 전이/생성/취소 권한 컨텍스트. permissionKeys = getPermissionSummary().keys → Set. */
export interface TransitionCtx {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;
  note?: string;
}

/** 메일 재시도/해소 권한 컨텍스트. isAdmin = systemRole OWNER||ADMIN (resolve 전용). */
export interface MailActionCtx {
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
  permissionKeys: Set<string>;
}

/** 문서 생성 포트 — 계약만. 구현체는 후속 sub-project가 자기 모듈에 둔다(spec §11). */
export interface GeneratorResult {
  files: Array<{ path: string; displayName: string; mimeType?: string; sizeBytes?: number }>;
}
export interface GeneratorPort {
  kind: WorkflowKind;
  generate(task: WorkflowTask): Promise<GeneratorResult>;
}

// 정책에서 쓰는 보조 별칭(소비처 가독성용).
export type { WorkflowKind, WorkflowStatus };
```

## Step 4 — policy.ts 구현

생성: `src/modules/workflows/policy.ts`

```ts
import type { WorkflowKind, WorkflowStatus } from "@prisma/client";

// 워크플로 종류별 허용 전이. 명시되지 않은 전이는 거부(fail-closed).
export const TRANSITIONS: Record<WorkflowKind, Partial<Record<WorkflowStatus, WorkflowStatus[]>>> = {
  WEEKLY_REPORT: { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] },
  BILLING: {
    PENDING: ["GENERATED", "CANCELLED"],
    GENERATED: ["SENT", "CANCELLED"],
    SENT: ["HQ_REQUESTED"],
    HQ_REQUESTED: ["FINAL_SENT"],
  },
  NOTIFICATION_BILLING: {
    PENDING: ["GENERATED", "CANCELLED"],
    GENERATED: ["REVIEWED", "SENT", "CANCELLED"],
    REVIEWED: ["HQ_REQUESTED"],
    HQ_REQUESTED: ["FINAL_SENT"],
  },
};

// 권한 검사용 리소스 매핑.
export const KIND_RESOURCE: Record<WorkflowKind, string> = {
  WEEKLY_REPORT: "workflows.weekly",
  BILLING: "workflows.billing",
  NOTIFICATION_BILLING: "workflows.notification",
};

// 전이 대상 → 요구 권한 액션.
export const ACTION_FOR_STATUS: Partial<Record<WorkflowStatus, string>> = {
  GENERATED: "generate",
  REVIEWED: "review",
  SENT: "send",
  HQ_REQUESTED: "send",
  FINAL_SENT: "send",
  CANCELLED: "view",
};

// toStatus → stamp할 WorkflowTask 컬럼(없으면 stamp 안 함, §4.3).
export const STAMP_FOR_STATUS: Partial<Record<WorkflowStatus, "generatedAt" | "reviewedAt" | "sentAt">> = {
  GENERATED: "generatedAt",
  REVIEWED: "reviewedAt",
  SENT: "sentAt",
};
```

## Step 5 — PASS

```bash
npm test -- tests/modules/workflows/policy.test.ts
```

## Step 6 — commit

```bash
git add src/modules/workflows/types.ts src/modules/workflows/policy.ts tests/modules/workflows/policy.test.ts
git commit -m "feat(workflows): transition policy data + ConflictError/port types"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과(boundaries: 모듈이 @prisma/client만 import)
npm test -- tests/modules/workflows/policy.test.ts   # PASS
```

## Cautions

- **TRANSITIONS에 terminal 상태(`FINAL_SENT`/`CANCELLED`)에서의 전이를 추가하지 말 것.** 이유: 종료 상태다. 빠지면 fail-closed로 자동 거부된다 — 명시 부재가 곧 거부다.
- **권한 행이 catalog에 없는 액션 키도 정책엔 그대로 둘 것**(`review` 등). 이유: 정책은 문자열 참조일 뿐 권한 존재를 요구하지 않는다. 실제 전이 시도 시에만 권한 검사가 일어난다(§5.2, §7).
- types.ts는 `WorkflowTask` 타입만 @prisma/client에서 가져온다 — 구체 생성 로직을 넣지 말 것(포트는 계약만).
