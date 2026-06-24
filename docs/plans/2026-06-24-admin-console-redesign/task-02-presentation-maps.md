# Task 02 — 표시명·컬러톤 매핑

사용자 화면(task-04)이 쓸 컬러톤·표시명 매핑을 기존 `labels.ts`에 추가한다. 상태·고용형태·직무·역할을 `ChipTone`으로, raw 역할 key를 한글 표시명으로 변환한다(디자인 공통 개선점 ②). 전부 순수 데이터·함수라 완전 TDD.

## Files

- Modify `src/app/(app)/admin/users/_components/labels.ts` (추가만 — 기존 export 변경 금지)
- Create `tests/app/admin/users/labels.test.ts`

## Prep

- entrypoint §Shared Contracts의 "표시명·톤 매핑" 시그니처.
- 기존 `labels.ts`: `UserStatusKey`, `STATUS_LABEL`, `EMPLOYMENT_LABEL`, `JOB_LABEL`, `ROLE_OPTIONS`(key→label·privileged) 이미 존재. `EmploymentType`/`JobFunction`은 `@/lib/auth/types`.
- `ChipTone`은 task-01의 `@/components/ui/chip`.

## Deps

01 (ChipTone 타입).

## Cautions

- **기존 export(`STATUS_LABEL` 등)는 건드리지 않는다 — 추가만.** Reason: user-edit·create-form 등 다른 소비처가 의존(surgical).
- **`ROLE_LABEL`은 `ROLE_OPTIONS`에서 파생한다**(별도 재작성 금지). Reason: user-edit이 ROLE_OPTIONS 라벨을 쓰므로 단일 출처로 표시명 일관성 유지.
- `labels.ts`는 서버/클라 공용 순수 모듈 — `"use client"` 붙이지 말 것.

## TDD steps

### 1. 실패 테스트

`tests/app/admin/users/labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  STATUS_TONE, EMPLOYMENT_TONE, JOB_TONE, ROLE_LABEL, ROLE_TONE, roleLabel, roleTone,
  STATUS_LABEL, EMPLOYMENT_LABEL, JOB_LABEL, ROLE_OPTIONS,
} from "@/app/(app)/admin/users/_components/labels";

describe("presentation tone maps", () => {
  it("STATUS_TONE covers every STATUS_LABEL key", () => {
    for (const k of Object.keys(STATUS_LABEL)) expect(STATUS_TONE[k as keyof typeof STATUS_TONE]).toBeTruthy();
    expect(STATUS_TONE.ACTIVE).toBe("ok");
    expect(STATUS_TONE.REJECTED).toBe("rose");
    expect(STATUS_TONE.DISABLED).toBe("off");
  });
  it("EMPLOYMENT_TONE / JOB_TONE cover their label keys", () => {
    for (const k of Object.keys(EMPLOYMENT_LABEL)) expect(EMPLOYMENT_TONE[k as keyof typeof EMPLOYMENT_TONE]).toBeTruthy();
    for (const k of Object.keys(JOB_LABEL)) expect(JOB_TONE[k as keyof typeof JOB_TONE]).toBeTruthy();
    expect(EMPLOYMENT_TONE.CONTRACTOR).toBe("amber");
    expect(JOB_TONE.CONTENT_MANAGER).toBe("purple");
  });
});

describe("role label/tone", () => {
  it("ROLE_LABEL is derived from ROLE_OPTIONS", () => {
    for (const o of ROLE_OPTIONS) expect(ROLE_LABEL[o.key]).toBe(o.label);
  });
  it("roleLabel falls back to the raw key", () => {
    expect(roleLabel("regular-developer")).toBe(ROLE_LABEL["regular-developer"]);
    expect(roleLabel("unknown-key")).toBe("unknown-key");
  });
  it("roleTone maps known roles and defaults to neutral", () => {
    expect(roleTone("pm")).toBe("pink");
    expect(roleTone("admin")).toBe("rose");
    expect(roleTone("contractor-content")).toBe("purple");
    expect(roleTone("contractor-civil-response")).toBe("orange");
    expect(roleTone("regular-developer")).toBe("blue");
    expect(roleTone("contractor-developer")).toBe("blue");
    expect(roleTone("nope")).toBe("neutral");
  });
});
```

실행: `npm test -- labels` → FAIL.

### 2. 구현 — labels.ts 말미에 추가

기존 파일 끝(`SCOPE_OPTIONS` 정의 뒤)에 아래를 **추가**한다. 상단 import에 `ChipTone` 추가.

import 추가(파일 맨 위):

```ts
import type { ChipTone } from "@/components/ui/chip";
```

파일 말미 추가:

```ts
// ── 컬러톤 매핑(Aurora 컬러칩, task-04 소비). 값=ChipTone. ──
export const STATUS_TONE: Record<UserStatusKey, ChipTone> = {
  PENDING: "amber",
  INVITED: "blue",
  ACTIVE: "ok",
  DISABLED: "off",
  REJECTED: "rose",
};
export const EMPLOYMENT_TONE: Record<EmploymentType, ChipTone> = {
  REGULAR: "blue",
  CONTRACTOR: "amber",
};
export const JOB_TONE: Record<JobFunction, ChipTone> = {
  PM: "pink",
  DEVELOPER: "blue",
  CONTENT_MANAGER: "purple",
  CIVIL_RESPONSE: "orange",
};

// raw 역할 key → 한글 표시명(ROLE_OPTIONS 단일 출처에서 파생).
export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((o) => [o.key, o.label]),
);
// 역할 key → 컬러톤. 직무 도메인 색을 따른다(개발=blue·콘텐츠=purple·민원=orange), 특권은 pink/rose.
export const ROLE_TONE: Record<string, ChipTone> = {
  pm: "pink",
  admin: "rose",
  "regular-developer": "blue",
  "contractor-developer": "blue",
  "contractor-content": "purple",
  "contractor-civil-response": "orange",
};

export function roleLabel(key: string): string {
  return ROLE_LABEL[key] ?? key;
}
export function roleTone(key: string): ChipTone {
  return ROLE_TONE[key] ?? "neutral";
}
```

`EmploymentType`/`JobFunction`은 이미 파일 상단에서 import 중(`import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";`).

실행: `npm test -- labels` → PASS.

### 3. 커밋

```
git add src/app/(app)/admin/users/_components/labels.ts tests/app/admin/users/labels.test.ts
git commit -m "feat(admin): 사용자 상태·고용·직무·역할 컬러톤/표시명 매핑"
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors (ChipTone 정확 매칭)
npm test -- labels  # 신규 테스트 통과
npm run lint        # 0 errors
```

기대: `STATUS_TONE`/`EMPLOYMENT_TONE`/`JOB_TONE`/`ROLE_LABEL`/`ROLE_TONE`/`roleLabel`/`roleTone` export, 기존 라벨 export 무변경.
