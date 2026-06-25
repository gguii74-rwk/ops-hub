# Task 02 — leave-calendar 진입 모달화 + 테스트 갱신

캘린더의 자가신청 진입(`+` 빠른추가, 팝오버 "이 날짜로 연차 신청")을 라우팅에서 `RequestLeaveModal` 오픈으로 교체한다.

## Files

- Modify: `src/app/(app)/leave/_components/leave-calendar.tsx`
- Modify: `tests/app/leave/leave-calendar.test.tsx`

## Prep

- 스펙 §설계 "수정: leave-calendar.tsx" 읽기.
- 엔트리포인트 §Shared Contracts의 `RequestLeaveModal` 시그니처(Task 01 산출물)·테스트 규약 사용.
- Task 01 완료(`request-leave-modal.tsx` 존재) 후 실행.

## Deps

Task 01.

## Step 1 — 테스트 갱신(실패 확인)

`tests/app/leave/leave-calendar.test.tsx` **전체를 아래로 교체**. 변경점: (1) react-query 모킹에 `useMutation`/`useQueryClient` 보강(모달이 사용), (2) `next/navigation` 라우터 모킹·라우팅 검증 제거, (3) 자가신청 진입 두 경로가 모달을 여는지 검증 추가.

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// react-query 모킹: useQuery(빈 이벤트) + RequestLeaveModal이 쓰는 useMutation/useQueryClient.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { LeaveCalendar } from "@/app/(app)/leave/_components/leave-calendar";

afterEach(() => {
  cleanup();
});

// 현재 KST 달의 15일 셀(항상 inMonth)을 열어 팝오버를 띄운다.
function open15th() {
  const cells = screen
    .getAllByRole("button")
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute("aria-label") ?? ""));
  const target = cells.find((b) => (b.getAttribute("aria-label") ?? "").endsWith("-15"))!;
  fireEvent.click(target);
}

describe("LeaveCalendar — 능력별 진입 분리(R1/R4)", () => {
  it("canCreate=true·canManage=false: 자가신청 유지(+ 노출·팝오버 신청), 관리자 입력 없음", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.getAllByRole("button", { name: /추가/ }).length).toBeGreaterThan(0); // 빠른추가 +
    open15th();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("이 날짜로 연차 신청")).toBeTruthy();
    expect(within(dialog).queryByText("관리자 직접 입력")).toBeNull();
  });

  it("canCreate=false·canManage=true: + 없음, 팝오버는 관리자 직접입력만", () => {
    render(<LeaveCalendar canCreate={false} canManage />);
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
    open15th();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("이 날짜로 연차 신청")).toBeNull();
    expect(within(dialog).getByText("관리자 직접 입력")).toBeTruthy();
  });

  it("팝오버 '이 날짜로 연차 신청' 클릭 시 자가신청 모달이 열린다", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("이 날짜로 연차 신청"));
    // 팝오버는 닫히고 자가신청 모달(title "연차 신청")만 남는다
    expect(within(screen.getByRole("dialog")).getByText("연차 신청")).toBeTruthy();
  });

  it("'+' 빠른추가 클릭 시 자가신청 모달이 열린다", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: /추가/ })[0]);
    expect(within(screen.getByRole("dialog")).getByText("연차 신청")).toBeTruthy();
  });
});
```

## Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/app/leave/leave-calendar.test.tsx
```

기대: 새 두 케이스(모달 오픈)가 FAIL — 아직 라우팅 동작이라 모달이 안 뜨거나, `+`가 라우팅됨.

## Step 3 — leave-calendar.tsx 구현 변경

다음 편집을 순서대로 적용한다(그 외 라인 변경 금지).

**(a) `next/navigation` import 제거.** 아래 라인 삭제:

```tsx
import { useRouter } from "next/navigation";
```

**(b) RequestLeaveModal import 추가.** `CreateLeaveModal` import 아래에 추가:

```tsx
import { CreateLeaveModal } from "./create-leave-modal";
import { RequestLeaveModal } from "./request-leave-modal";
```

**(c) `router` 제거 + 자가신청 모달 상태 추가.** 컴포넌트 본문 상단의

```tsx
  const router = useRouter();
  const [cursor, setCursor] = useState(kstNow); // KST 기준 현재 월
  const [creating, setCreating] = useState<string | null>(null); // 관리자 직접입력 모달 defaultDate(null=닫힘)
```

를 아래로 교체:

```tsx
  const [cursor, setCursor] = useState(kstNow); // KST 기준 현재 월
  const [creating, setCreating] = useState<string | null>(null); // 관리자 직접입력 모달 defaultDate(null=닫힘)
  const [requesting, setRequesting] = useState<string | null>(null); // 자가신청 모달 defaultDate(null=닫힘)
```

**(d) quickAdd를 모달 오픈으로 교체.** 아래

```tsx
  // 빠른추가 + = 본인 자가신청(self-service). 라우트 보존(/leave/request 페이지가 create 권한 enforce).
  const quickAdd = canCreate ? (dateKey: string) => router.push(`/leave/request?date=${dateKey}`) : undefined;
```

를 아래로 교체:

```tsx
  // 빠른추가 + = 본인 자가신청(self-service) 모달 오픈. /api/leave/requests가 create 권한 enforce.
  const quickAdd = canCreate ? (dateKey: string) => setRequesting(dateKey) : undefined;
```

**(e) 팝오버 "이 날짜로 연차 신청" 버튼을 모달 오픈으로 교체.** 아래

```tsx
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      close();
                      router.push(`/leave/request?date=${dateKey}`);
                    }}
                  >
                    이 날짜로 연차 신청
                  </Button>
```

를 아래로 교체:

```tsx
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      close();
                      setRequesting(dateKey);
                    }}
                  >
                    이 날짜로 연차 신청
                  </Button>
```

**(f) RequestLeaveModal 렌더 추가.** 기존 CreateLeaveModal 렌더 블록

```tsx
      {creating !== null && (
        <CreateLeaveModal defaultDate={creating || undefined} onClose={() => setCreating(null)} />
      )}
```

바로 아래에 추가:

```tsx
      {requesting !== null && (
        <RequestLeaveModal defaultDate={requesting || undefined} onClose={() => setRequesting(null)} />
      )}
```

## Step 4 — 실행(PASS 확인) + 커밋

```bash
npm test -- tests/app/leave/leave-calendar.test.tsx
npm run typecheck
npm run lint
```

기대: 테스트 4건 PASS, typecheck/lint clean(`useRouter` 미사용 orphan 제거됨).

커밋(변경 파일 명시 stage):

```bash
git add src/app/(app)/leave/_components/leave-calendar.tsx tests/app/leave/leave-calendar.test.tsx
git commit -m "feat(leave): 캘린더 자가신청 진입(+·팝오버)을 모달로 통일"
```

## Acceptance Criteria

- `npm test -- tests/app/leave/leave-calendar.test.tsx` → 4 passed.
- `npm run typecheck` → 에러 0.
- `npm run lint` → 에러 0(특히 `useRouter`/`router` 미사용 경고 없음).
- 전체 스위트 회귀 확인: `npm test` → 기존 통과 수 + 신규(Task 01 2건 포함) 유지, 실패 0.

## Cautions

- **Don't `next/navigation` import·`router`를 남겨두지 말 것.** Reason: 라우팅을 모두 제거하면 미사용 orphan이 되어 lint가 깨진다. 내 변경이 만든 orphan만 정리한다(다른 미사용 코드는 손대지 않음).
- **Don't `creating`(관리자) 경로를 건드리지 말 것.** Reason: 관리자 직접입력은 이미 모달이며 본 task 범위는 자가신청 진입뿐. 종료일 기본값은 Task 01에서 처리됨.
- **Don't 팝오버 dialog와 모달 dialog가 동시에 떠 있다고 가정하지 말 것.** Reason: 자가신청 버튼 onClick은 `close()`로 팝오버를 닫은 뒤 모달을 연다 → 화면엔 dialog 하나뿐. 테스트의 `getByRole("dialog")`가 모달을 정확히 가리킨다.
