# 대금청구(Billing) UI 구현 계획 (split entrypoint)

- Feature: 대금청구 1·2단계 UI (설정 관리 → 작업 생성 → 문서 생성 → 다운로드 → 1·2단계 발송)
- Goal: 완료된 대금청구 백엔드 API 위에, 사용자가 설정 입력부터 1·2단계 발송까지 화면으로 끝까지 수행하는 UI를 얹는다.
- Architecture: 기존 `src/app/(app)/workflows`의 list/detail 골격을 계승·보강한다(백지 신설 아님). UI는 `fetch`로 기존 API만 호출(도메인 모듈 직접 import 금지, 라우트 경유). 백엔드는 **2건만** 최소 보강(D1): ① detail `effectiveRecipients`(`:send` 게이트 read), ② 생성 API `kind` 수용. 메일 템플릿·KST/회차일 변환은 순수 함수로 분리해 단위 테스트한다.
- Tech Stack: Next.js App Router, React Query(`@tanstack/react-query`), 공용 프리미티브(`@/components/ui/*`), sonner 토스트, vitest + @testing-library/react.
- Spec: `docs/specs/2026-06-30-workflows-billing-ui-design.md` (적대검증 완료, D1~D12). 선행 백엔드 spec `docs/specs/2026-06-29-workflows-billing-backend-design.md`(PR #28 머지).

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-30-workflows-billing-ui/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

태스크 2개 이상이 참조하는 계약을 여기 한 곳에 둔다. 태스크 파일은 이 절을 가리키며 재인라인하지 않는다.

### SC-1. 기존 백엔드 API (UI가 소비 — 봉투 없음, `Cache-Control: no-store`)

| 메서드·경로 | 요청 | 응답 | 권한 |
| --- | --- | --- | --- |
| `GET /api/workflows?status=CSV` | — | `{ items: TaskListItem[] }` | kind별 `:view` |
| `POST /api/workflows` | `{ kind, scheduledAt }`(SC-3) | `201 { id }` | `<kind>:create` |
| `GET /api/workflows/[id]` | — | `TaskDetailView`(SC-4) | `<kind>:view` |
| `POST /api/workflows/[id]/cancel` | — | `200` | `:view`+본인/owner |
| `POST /api/workflows/[id]/generate` | — | `200 { ok }` | `<kind>:generate` |
| `POST /api/workflows/[id]/send` | `{ step:1\|2, subject, body, recipients }`(SC-5) | `200 { ok }` | `<kind>:send` |
| `GET /api/workflows/[id]/files/[fileId]` | — | 파일 스트림(`Content-Disposition`) | `<kind>:view` |
| `GET /api/workflows/[id]/download` | — | ZIP 스트림 | `<kind>:view` |
| `GET /api/workflows/billing/config` | — | `BillingConfigDto[]`(SC-6) | `workflows.billing:view` |
| `POST /api/workflows/billing/config` | `BillingConfigInput`(SC-6) | `201 BillingConfigDto`(409=year중복) | `:configure` |
| `GET /api/workflows/billing/config/[year]` | — | `BillingConfigDto`(404 가능) | `:view` |
| `PATCH /api/workflows/billing/config/[year]` | `Partial<BillingConfigInput\year>` | `BillingConfigDto` | `:configure` |
| `DELETE /api/workflows/billing/config/[year]` | — | `200`(회차 연쇄 삭제) | `:configure` |
| `GET /api/workflows/billing/config/[year]/rounds` | — | `RoundDateDto[]`(SC-6) | `:view` |
| `PUT /api/workflows/billing/config/[year]/rounds/[round]` | `{ submitDate: ISOdatetime }` | `RoundDateDto` | `:configure` |
| `DELETE /api/workflows/billing/config/[year]/rounds/[round]` | — | `200`(404 가능) | `:configure` |

- 에러: 400(검증/ZodError `{error,issues}`)·403(ForbiddenError)·404·409(ConflictError)·422(NotImplementedError)·500. 다운로드/files는 권한·부재 시 404/403(조용한 실패 없음).
- `POST config`·`PATCH config`·`PUT rounds`는 ZodError를 `400 {error:"invalid",issues}`로 반환.

### SC-2. 이 슬라이스의 백엔드 변경 (D1 = 2건, 전이/상태머신 불변)

1. **`effectiveRecipients`** (task-02): `getTaskDetailView`가 호출자에게 `<kind>:send` 권한이 **있을 때만** `effectiveRecipients: string[]`을 응답에 포함(없으면 필드 생략). 값 = `task.recipients`(비어있지 않으면) → `type.defaultRecipients` → `[]`. 라우트 변경 없음(이미 `permissionKeys` 전달).
2. **생성 API `kind` 수용**(task-01, D12): `createTaskSchema`가 `{ kind, scheduledAt }`. 서버가 `findWorkflowTypeByKind(kind)`로 `typeId` 해석, 권한 `KIND_RESOURCE[kind]:create`. 미지 kind·해석 실패·권한 없음 → `ForbiddenError`(403).

### SC-3. 작업 생성 페이로드

```ts
// validations: createTaskSchema (task-01에서 typeId → kind로 교체)
const WORKFLOW_KINDS = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING"] as const;
export const createTaskSchema = z.object({
  kind: z.enum(WORKFLOW_KINDS),
  scheduledAt: z.string().min(1), // ISO 또는 YYYY-MM-DD. Date 변환·유효성은 라우트에서.
});
// UI(create-task-modal)는 항상 { kind: "BILLING", scheduledAt } 전송.
```

### SC-4. 작업 상세 뷰 (UI `Detail` 타입 — effectiveRecipients 추가)

```ts
interface Detail {
  id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: string[]; // :send 권한자에게만 백엔드가 포함(SC-2 ①). 없으면 undefined.
}
// FileView/MailView/TimelineEntry/WfStatus/MailStatus는 기존 labels.ts·workflow-detail.tsx 정의 그대로.
```

### SC-5. 발송 페이로드 (send route 계약 — 기존)

```ts
// POST /api/workflows/[id]/send — 기존 sendSchema(변경 금지):
{ step: 1 | 2, subject: string /*min1*/, body: string, recipients?: string[] /*email[]*/ }
// UI(send-modal)는 D6 fail-closed: recipients를 항상 명시 포함(화면 표시 목록과 정확히 일치). To 빈 목록이면 제출 차단(fetch 미발생).
// body는 HTML 문자열(deliver가 html로 사용) — send-modal이 plain → HTML 변환 후 전송(plainToHtml, SC-8).
```

### SC-6. 설정 DTO (기존 billing-config service — 금액은 Number)

```ts
interface BillingConfigDto {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: number; monthlyAmount: number; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: string; updatedAt: string;
}
interface RoundDateDto { round: number; submitDate: string /* UTC ISO ...Z */ }
// 생성/수정 입력(클라 검증 경계, 서버 zod가 권위):
//   contractAmount/monthlyAmount = 양의 정수(원). contractAmount ≤ MAX_SAFE_INTEGER, monthlyAmount ≤ floor(MAX_SAFE_INTEGER/12).
//   projectName/contractNumber/contractAmountKor/monthlyAmountKor = min 1.
```

### SC-7. KST·날짜 변환 계약 (D4·D11 — 백엔드 규칙 재사용으로 parity 보장)

- **전월·회차·연도(D4)**: 백엔드 순수 함수 `computeBillingPeriod`·`toKstFields`(`@/modules/workflows/billing/period`, server-only 아님·순수)를 **app에서 import**해 그대로 사용한다(boundaries: app→module 허용). 로컬 `Date` 월/연 메서드 금지. `computeBillingPeriod(scheduledAt)` → `{ projectYear, round /*=전월(KST), 1~12*/, billingDate }`. `toKstFields(d)` → `{ year, month/*1-based*/, day }`(KST). 이렇게 하면 골든 산출물의 회차/연도와 100% 일치(재현보다 강한 parity — D4 충족).
- **회차 제출일(D11)**: date input `YYYY-MM-DD`를 **KST 자정 기준 UTC ISO(`...Z`)**로 변환해 PUT. 역(표시)은 KST로 환원.
  ```ts
  // 정방향: "2026-02-10" → "2026-02-09T15:00:00.000Z"
  export const dateInputToSubmitDateIso = (d: string): string => new Date(`${d}T00:00:00+09:00`).toISOString();
  // 역방향: "2026-02-09T15:00:00.000Z" → "2026-02-10" (KST)
  export const submitDateIsoToDateInput = (iso: string): string => {
    const s = toKstFields(new Date(iso)); // {year,month,day} KST
    return `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`;
  };
  ```

### SC-8. 메일 템플릿 (D3·§5 — day-sync 포팅 + projectName·KST 치환)

```ts
// src/app/(app)/workflows/mail-templates.ts (순수 함수)
export interface BillingMailContext { scheduledAt: Date; projectName: string }
export function buildSubject(step: 1 | 2, ctx: BillingMailContext): string;
export function buildBody(step: 1 | 2, ctx: BillingMailContext): string;
export function plainToHtml(plain: string): string; // HTML escape 후 줄바꿈 보존(deliver html용 — 주입 차단 F-A1)
// round = computeBillingPeriod(scheduledAt).round(전월,KST); projectYear = .projectYear;
// billingM/billingD = toKstFields(scheduledAt).month/.day; weekday = KST 요일("일"~"토").
```

표준 텍스트(이 슬라이스 구현 대상 — 최종 문구는 3층 수동 게이트로 확인):

- step1 제목: `${projectYear}년 ${projectName} ${round}월 대금 청구의 건`
- step2 제목: `${projectYear}년 ${projectName} ${round}월 대금 청구 서류 요청의 건`
- step1 본문:
  ```
  안녕하세요, 유라클 노원국 입니다.

  ${projectYear}년 ${projectName} ${round}월 대금 청구 관련 서류보내드리니
  확인 및 검토 부탁드리겠습니다.
  공문 발송일은 ${billingM}월 ${billingD}일로 작성하였습니다.
  검토가 끝나면 직인 날인 후 ${billingM}월 ${billingD}일(${weekday})에 원본 서류 전달 드리겠습니다.

  감사합니다.
  ```
- step2 본문:
  ```
  안녕하세요, 세종개발본부 노원국 입니다.

  ${projectName} 대금 청구 관련하여 서류 요청 드립니다.
  ${billingM}월 ${billingD}일(${weekday}) 발행한 국세/지방세 완납증명서, 4대보험 완납증명서 스캔본(PDF)을 메일로 회신 부탁 드리겠습니다.

  감사합니다.
  ```

### SC-9. 권한 키 매핑 (§7 — UI useCan과 서버 게이트 동일 키)

| 화면/액션 | 키 |
| --- | --- |
| 목록·상세·다운로드 | `workflows.billing:view` |
| 작업 생성(모달·버튼) | `workflows.billing:create` |
| 문서 생성 | `workflows.billing:generate` |
| 1·2단계 발송 + 발송 모달 진입 + `effectiveRecipients` prefill | `workflows.billing:send` |
| 설정 페이지 읽기 | `workflows.billing:view` |
| 설정 저장/삭제 | `workflows.billing:configure` |

UI 클라이언트 게이트: `useCan(resource, action)`(`@/lib/auth/permissions-client`). 숨김은 UX일 뿐 — API도 동일 키 fail-closed.

### SC-10. 상세 상태 → 액션·발송 단계 (§4.3·D10 — BILLING 한정)

| status | 액션 | 발송 step |
| --- | --- | --- |
| PENDING | `문서 생성`(generate) · 취소 | — |
| GENERATED | 다운로드(개별·ZIP) · `1단계 발송` · 취소 | 1 |
| SENT | 다운로드 · `2단계 발송` | 2 |
| HQ_REQUESTED | 다운로드 · "최종발송은 후속 단계" 안내 | — |
| CANCELLED | (없음) | — |

- **재생성 없음(D10)**: GENERATED에 재생성 액션을 두지 않는다. `문서 생성`은 PENDING에서만.
- 상세 액션 슬롯은 **`detail.kind === "BILLING"`일 때만** 렌더(weekly/notification은 기존대로 빈 슬롯 — 별도 sub-project). 기존 진행이력·생성파일·메일 목록·재시도/확정은 모든 kind 유지.

### SC-11. UI·테스트 관례

- 공용 프리미티브: `Button`(asChild 미지원 → 링크는 `<a className={buttonVariants({...})}>`)·`Modal`(Esc/배경 닫기·focus trap 내장)·`Input`·`Select`·`Textarea`·`Table*`·`Badge`·`PageSection`/`PageHeader`·`EmptyState`/`LoadingState`/`ErrorState`.
- 모달은 `request-leave-modal` 패턴: `useMutation` + `Modal` + **제출 중 닫기 차단(guardedClose)** (in-flight 결과 보존 — 기존 확정 결정).
- React Query 키: 목록 `["workflows"]`, 상세 `["workflow", taskId]`. 변경 후 둘 다 invalidate.
- 테스트(`tests/` 미러): jsdom. react-query 모듈 통째 mock(`useMutation.mutate` = `mutationFn` 즉시 호출, `useQueryClient().invalidateQueries` = spy). `useCan`은 `@/lib/auth/permissions-client` mock(hoisted, 키별 토글). `fetch`는 `vi.stubGlobal`. sonner `toast`는 mock. `npm test`는 `.env`(DATABASE_URL) 주입 필요.
- 봉투 없음: API 응답을 그대로 파싱(`json.success` 분기 없음).

---

## Tasks

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 생성 API `kind` 수용 (D12·F5) | [ ] | [task-01](2026-06-30-workflows-billing-ui/task-01-create-kind.md) | — | |
| 02 | detail `effectiveRecipients` (`:send` 게이트, §6·F3) | [ ] | [task-02](2026-06-30-workflows-billing-ui/task-02-effective-recipients.md) | — | |
| 03 | 순수 헬퍼: 메일 템플릿 + 회차일 변환 (D3·D4·D11·F6) | [ ] | [task-03](2026-06-30-workflows-billing-ui/task-03-pure-helpers.md) | — | |
| 04 | 설정 페이지 (계약정보 + 회차표) | [ ] | [task-04](2026-06-30-workflows-billing-ui/task-04-settings-page.md) | 03 | |
| 05 | 작업 생성 모달 + 목록 버튼 | [ ] | [task-05](2026-06-30-workflows-billing-ui/task-05-create-modal.md) | 01 | |
| 06 | 발송 모달 (1·2단계, prefill·fail-closed) | [ ] | [task-06](2026-06-30-workflows-billing-ui/task-06-send-modal.md) | 02, 03 | |
| 07 | 상세 액션 슬롯 (생성·다운로드·발송) | [ ] | [task-07](2026-06-30-workflows-billing-ui/task-07-detail-actions.md) | 06 | |
| 08 | 네비게이션 "대금청구 설정" 등록 | [ ] | [task-08](2026-06-30-workflows-billing-ui/task-08-navigation.md) | — | |

실행 순서 권장: 01·02·03·08(독립) → 04 → 05 → 06 → 07. 각 태스크는 게이트(`npm run typecheck`/`lint`/`test`)를 통과해야 다음으로 넘어간다.
