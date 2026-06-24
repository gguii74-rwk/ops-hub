# 관리 콘솔 UI 재디자인 (Aurora + Handle Cards)

## Feature

ops-hub 관리 콘솔 4화면(사용자·팀·권한 매트릭스·메뉴)의 **데이터 표출 UI**를 확정 디자인 **Aurora**(요약 통계 스트립 → 카드 → pill 툴바 + 채움형 컬러칩)로 통일하고, 메뉴 트리를 **Handle Cards**(드래그로 같은 부모 안 순서 변경)로 재설계한다.

## Goal

네 화면이 같은 디자인 언어(PageHeader · StatStrip · Chip · Toolbar)를 공유하고, 메뉴 순서를 드래그(+키보드)로 바꿀 수 있게 하되, **접근제어·동시성·낙관락 등 기존 도메인 로직은 손대지 않는다**.

## Architecture

표현 계층만 교체한다. 공용 프리미티브 4종(`Chip`·`Switch`·`StatStrip`·`Toolbar/Pill`)을 신설하고 `PageHeader`에 `eyebrow`를 추가한 뒤, 각 화면 컴포넌트를 이 프리미티브로 다시 조립한다. 도메인 호출(fetch·mutation·낙관락 키·CAS·advisory lock·RolePreview out-of-order 가드)은 그대로 두고 JSX/스타일만 바꾼다. 유일한 비-UI 변경은 사용자 StatStrip용 **읽기 전용 집계**(`listUsers`에 `stats` 추가 — 기존 `pendingCount`와 동일 패턴, 마이그레이션 없음).

## Tech Stack

Next.js App Router(client components), React 19, Tailwind v4(`@theme` 토큰 + 기본 팔레트), @tanstack/react-query, zod. 테스트 = vitest + @testing-library/react(jsdom, 파일별 `// @vitest-environment jsdom` pragma; user-event 없음 → `fireEvent`).

---

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-24-admin-console-redesign/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## 결정·전제 (구현 전 사용자 확인 가능 — 디자인 방향은 확정, 아래는 구현 판단)

1. **사용자 StatStrip은 읽기 전용 집계를 추가한다.** 디자인이 "승인 대기/전체/활성/외주" 4스탯을 요구하는데, 필터 무관 전체 수가 필요하다. `listUsers`에 `stats:{total,active,contractor}`를 `pendingCount`와 똑같이 분리 집계로 추가(마이그레이션·쓰기 없음). 팀 StatStrip은 이미 내려오는 `teams` 배열에서 파생(백엔드 변경 없음).
2. **메뉴 활성 토글은 모든 행(대·중메뉴)에 둔다.** 시안 변형1은 대메뉴에만 토글을 그렸으나, 기능상 중메뉴도 `isActive`가 있고 백엔드 PATCH가 이미 지원하므로 일관성을 위해 전 행에 `Switch`를 노출한다.
3. **드래그 핸들이 키보드 재정렬을 겸한다(↑↓ 버튼 제거).** 핸들을 포커스 가능한 버튼으로 만들어 포인터 드래그 + `ArrowUp/ArrowDown` 재정렬을 모두 처리한다 — 시안(핸들만 노출)에 맞추면서 키보드 접근성을 유지. 기존 ↑↓ 버튼은 핸들로 대체.
4. **컬러칩은 Tailwind 기본 팔레트로 구현(globals.css 토큰 추가 없음).** `emerald/blue/amber/purple/orange/fuchsia/rose/slate` 50/700(+dark 변형)로 시안 색에 근접 — 다크모드 자동 처리, 토큰 폭증 방지.

## Shared Contracts

태스크 파일은 이 절을 재인용하지 말고 "entrypoint §Shared Contracts"로 참조한다.

### 신설 프리미티브 시그니처 (task-01이 생성, 04~07이 소비)

```ts
// src/components/ui/chip.tsx
export type ChipTone = "ok" | "off" | "blue" | "amber" | "purple" | "orange" | "pink" | "rose" | "neutral";
export function Chip(props: React.ComponentProps<"span"> & { tone?: ChipTone }): React.JSX.Element;
// tone → Tailwind 클래스(다크 포함). neutral = bg-muted/text-muted-foreground. 칩 형태: 채움형 rounded-md px-2 py-0.5 text-xs font-semibold.

// src/components/ui/switch.tsx  (controlled, role=switch)
export function Switch(props: {
  checked: boolean; onCheckedChange: (next: boolean) => void;
  disabled?: boolean; label?: string;            // label = 접근성 aria-label(시각 텍스트는 호출부에서)
  className?: string;
}): React.JSX.Element;

// src/components/ui/stat-strip.tsx
export function StatStrip(props: { children: React.ReactNode; className?: string }): React.JSX.Element; // flex flex-wrap gap-2
export function Stat(props: { value: React.ReactNode; label: React.ReactNode; accent?: boolean; onClick?: () => void; className?: string }): React.JSX.Element;
// accent=true → bg-secondary/accent 강조. onClick 있으면 button으로 렌더(필터 점프용).

// src/components/ui/toolbar.tsx
export function Toolbar(props: { children: React.ReactNode; className?: string }): React.JSX.Element; // flex flex-wrap items-center gap-2
export function Pill(props: { active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string }): React.JSX.Element;
// Pill = 토글 버튼(active → bg-foreground text-background, aria-pressed 내부 설정). 둥근 rounded-full border.
```

### PageHeader 확장 (task-01)

```ts
// src/components/ui/page-section.tsx — PageHeader에 eyebrow 추가(기존 시그니처 호환: eyebrow는 선택)
function PageHeader(props: {
  title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode;
  eyebrow?: React.ReactNode;   // 신규 — 대문자 라벨(예: "구성원"). 있으면 타이틀 위에 작은 uppercase 라벨.
}): React.JSX.Element;
```

### 표시명·톤 매핑 (task-02가 `src/app/(app)/admin/users/_components/labels.ts`에 추가, 04가 소비)

```ts
import type { ChipTone } from "@/components/ui/chip";
export const STATUS_TONE: Record<UserStatusKey, ChipTone>;      // PENDING:amber INVITED:blue ACTIVE:ok DISABLED:off REJECTED:rose
export const EMPLOYMENT_TONE: Record<EmploymentType, ChipTone>; // REGULAR:blue CONTRACTOR:amber
export const JOB_TONE: Record<JobFunction, ChipTone>;           // PM:pink DEVELOPER:blue CONTENT_MANAGER:purple CIVIL_RESPONSE:orange
export const ROLE_LABEL: Record<string, string>;               // ROLE_OPTIONS에서 파생(key→label)
export const ROLE_TONE: Record<string, ChipTone>;              // pm:pink admin:rose *-developer:blue *-content:purple *-civil-response:orange
export function roleLabel(key: string): string;                // 미지의 key는 그대로 반환
export function roleTone(key: string): ChipTone;               // 미지의 key는 "neutral"
```

### 사용자 목록 집계 (task-03이 추가, 04가 소비)

```ts
// listUsers 반환에 stats 추가 — 모두 필터 무관 전수 집계(pendingCount와 동형)
interface UserListResult {
  rows: UserRow[];
  total: number;        // (기존) 필터 적용 총건수 — 페이지네이션용
  pendingCount: number; // (기존) status=PENDING 전수
  stats: { total: number; active: number; contractor: number }; // (신규) 전수/활성/외주 전수
}
// API GET /api/admin/users 응답에 stats 그대로 통과. 프런트 ListResponse에도 stats 추가.
```

### 메뉴 재정렬·토글 순수 헬퍼 (task-07이 추가)

```ts
// navigation-editor.tsx — TDD 대상 순수 헬퍼(payload.test.ts 확장)
export function moveItem<T>(items: T[], from: number, to: number): T[]; // from→to 이동한 새 배열(불변)
export function toToggleActivePayload(node: { isActive: boolean; updatedAt: string }): { isActive: boolean; updatedAt: string };
// 기존 reorder mutation 재사용: reorder.mutate({ parentId, orderedItems: ordered.map(s=>({id,updatedAt})) })
```

## 불변식 (모든 태스크 공통 — 깨면 안 됨)

- **접근제어**: UI `useCan`/서버 `requirePermission` 동일 키, fail-closed. UI는 표시만 바뀌고 권한 검사 로직·`canConfigure`/`canCreate`/`canApprove` 분기는 그대로.
- **동시성/낙관락**: `updatedAt` CAS, status-CAS, advisory lock, RolePreview out-of-order 가드(AbortController+토큰), reparent/delete TOCTOU 가드 — 표현 계층 교체 중 **호출 인자·순서·키를 변경하지 않는다**.
- **매트릭스**: `role.key === "pm"` 잠금 유지, ROLE_DISPLAY_ORDER 정렬(서버 `getMatrix`)·`role.name`(한글) 표시 유지, 묶음부여(bulkSet)·setCell 시그니처 유지.
- **두 노트북 git 위생**: 커밋 전 `.git/index.lock` 확인, 변경 파일만 명시 stage.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 공용 프리미티브(Chip·Switch·StatStrip·Toolbar/Pill) + PageHeader eyebrow | [ ] | [task-01](2026-06-24-admin-console-redesign/task-01-ui-primitives.md) | — | |
| 02 | 표시명·컬러톤 매핑(labels 확장) | [ ] | [task-02](2026-06-24-admin-console-redesign/task-02-presentation-maps.md) | 01 | |
| 03 | 사용자 목록 집계(stats) 백엔드 | [ ] | [task-03](2026-06-24-admin-console-redesign/task-03-users-list-stats.md) | — | |
| 04 | 사용자 관리 화면 재디자인 | [ ] | [task-04](2026-06-24-admin-console-redesign/task-04-users-ui.md) | 01,02,03 | |
| 05 | 팀 관리 화면 재디자인 | [ ] | [task-05](2026-06-24-admin-console-redesign/task-05-teams-ui.md) | 01,02 | |
| 06 | 권한 매트릭스 화면 재디자인 | [ ] | [task-06](2026-06-24-admin-console-redesign/task-06-roles-matrix-ui.md) | 01 | |
| 07 | 메뉴 트리 Handle Cards(드래그+토글) | [ ] | [task-07](2026-06-24-admin-console-redesign/task-07-navigation-handle-cards.md) | 01 | |

권장 실행 순서: 01 → 02 → 03 → 04 → 05 → 06 → 07. (03은 01/02와 독립이라 병행 가능.)

## 실행·검증 메모

- 각 태스크 종료 = `npm run typecheck && npm run lint && npm test` green + 단계 커밋. 화면 태스크는 추가로 `npm run build` 통과.
- 마이그레이션 없음 → dev 배포는 표준 restart. 휴대폰 미리보기 kgs-dev `:3210` 정적서버(시안용)는 **구현 착수 시 정리**(`pkill -f "http.server 3210"` + `/home/kgs/mockups`).
- 단계 완료마다 `dev-workflow:review-loop`로 적대검증.
