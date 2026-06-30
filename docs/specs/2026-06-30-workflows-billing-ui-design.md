# 대금청구(Billing) UI 설계

- Status: Draft (brainstorming 합의 반영 — 범위 A·화면배치 A·메일 템플릿 (a))
- Date: 2026-06-30
- 선행: **대금청구 백엔드** `docs/specs/2026-06-29-workflows-billing-backend-design.md` + **PR #28 머지 완료**(`be88db3`). 설정 CRUD·HWPX 4종 생성·1·2단계 발송·다운로드 API가 이미 존재한다.
- Roadmap: `docs/product/modernization-roadmap.md` Phase 4 (Workflows 포팅) — sub-project 3(대금청구) UI 슬라이스
- 마이그레이션 레퍼런스: `D:\workspace\day-sync` (`src/app/settings/billing`, `src/app/tasks/[taskId]`, `.../send`, `components/calendar/create-task-modal.tsx`)

## 1. 목표와 범위

완료된 대금청구 백엔드 API 위에, 사용자가 **설정 입력 → 작업 생성 → HWPX 문서 생성 → 다운로드 → 1단계(고객 승인요청) → 2단계(본사 서류요청)**까지 화면으로 끝까지 수행할 수 있는 UI를 얹는다. 기존 `src/app/(app)/workflows`의 list/detail 골격을 계승·보강한다(백지 신설 아님).

### 포함

- ① 대금청구 **설정 관리 화면** — `BillingConfig` 연도별 CRUD + 1~12회차 제출일 관리
- ② 작업 **생성** — 목록 화면의 생성 모달(유형=대금청구, 예정일)
- ③ 작업 **상세의 빈 액션 slot 채우기** — 상태머신 기반 `문서 생성`·`재생성`·`다운로드(개별/ZIP)`·`1·2단계 발송`
- ④ **발송 모달** — 수신자·제목·본문 편집 후 전송(단계별 기본 템플릿 자동 생성)
- ⑤ 사이드바 네비게이션에 설정 메뉴 추가 + 권한 게이트
- ⑥ 컴포넌트·단위 테스트(vitest + testing-library)

### 비포함 (후속)

- **3단계(FINAL_SENT) 최종발송 + 파일 업로드 첨부** — 백엔드 미구현(spec §1 비포함). UI도 제외, 상세에서 "후속 단계" 안내만 노출.
- **CC/BCC** — 백엔드 `send`가 수신자 단일 목록(To)만 받음. 도입하지 않는다.
- **메일 템플릿 CRUD/관리 화면** — 템플릿은 코드 내 단계별 함수로 고정(YAGNI).
- **주간보고·알림톡 UI** — 별도 sub-project.
- **백엔드 신규 도메인 로직** — 이 슬라이스는 기존 API 소비가 원칙. 단 §6 수신자 prefill을 위해 detail 응답에 `effectiveRecipients` read-only 1건을 추가한다(전이/쓰기 등 도메인 로직 추가는 없음).

## 2. 설계 결정 요약

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | **범위 = 1·2단계 UI.** 완료된 generate/send/download/config API를 소비. 백엔드 변경은 detail 응답에 `effectiveRecipients` read-only 노출 1건뿐(§6) | 위험한 본체(백엔드)는 끝났고 검증됨. 3단계는 업로드 backend 계약이 필요해 후속(백엔드 spec §1) |
| D2 | **화면 배치 = detail 인라인 액션 + 발송 모달**, 설정만 별도 페이지, 작업 생성도 모달 | 기존 `workflow-detail.tsx`가 단일 페이지에 액션 인라인(취소·재시도·확정). 공용 Modal 프리미티브 재사용. 라우트 최소 |
| D3 | **메일 제목/본문 = 단계별 기본 템플릿 자동 생성 + 발송 화면 편집.** 텍스트는 UI(caller)가 구성해 `send`에 전달 | 백엔드 `send`가 `subject`/`body`를 caller 제공으로 받음(백엔드 D7). day-sync도 동일 패턴(자동생성 후 편집) |
| D4 | **전월·회차·연도 = 클라이언트 KST 계산**(`Intl.DateTimeFormat`, `timeZone: "Asia/Seoul"`). 로컬 `Date` 월/연 메서드 금지 | 백엔드 `computeBillingPeriod`(KST 전월=회차, 전월 연도=projectYear) 규칙을 UI에서 재현. 서버 TZ 비KST 무관하게 동작. 클라 로컬 메서드는 월 경계 오산 위험 |
| D5 | **사업명 = 발송 모달 open 시 `GET config/[projectYear]` 재사용** | `BillingConfig.projectName`이 템플릿 재료. 기존 config GET으로 충분(백엔드 추가 0) |
| D6 | **수신자 = To 단일 목록(쉼표 분리), fail-closed.** 발송 모달은 detail의 `effectiveRecipients`(작업.recipients ?? 유형.defaultRecipients)로 prefill·편집 가능. **제출 시 최소 1명 필수(빈 To = 검증 오류, 발송 차단), POST에는 화면에 표시된 정확한 수신자 목록을 항상 명시 전달** — 빈 채로 보내 백엔드 폴백에 의존하지 않는다 | 발송 모달은 메일 발송 전 **마지막 신뢰 경계** — 빈 To로 보내 기본(오래·의도치 않은) 수신자에게 대금청구 문서가 무음 발송되는 위험 차단. 백엔드 `send`의 폴백은 수신자를 생략한 **비-UI 호출자용으로 보존**(UI는 항상 명시 전달). prefill 재료는 detail read-only 노출. CC/BCC 없음 |
| D7 | **권한 = `useCan("workflows.billing", generate\|send\|configure)`.** 메뉴 숨김은 UX, API도 동일 키 검사(fail-closed) | 접근제어 규칙①②. 기존 detail의 `canSend` 패턴 재사용 |
| D8 | **네비 = 사이드바 `workflows` 하위 "대금청구 설정"**(`NavigationItem.requiredPermissionId = workflows.billing:configure`). seed에 등록 | 네비 CMS·권한 매트릭스 패턴 계승 |
| D9 | **테스트 = 컴포넌트/단위(vitest+RTL) + 수동 통합.** 구현 중 로컬 docker PostgreSQL + dev, 머지 후 kgs-dev 배포 smoke | 화면 흐름은 사람 확인이 최종(백엔드 골든처럼). playwright 자동화는 이번 범위 과함 |

## 3. 모듈 구조와 경계

```
src/app/(app)/workflows/
  workflows-list.tsx          # 변경 — "새 대금청구 작업" 버튼 + 생성 모달 트리거
  create-task-modal.tsx       # 신규 — 작업 생성(유형·예정일) → POST /api/workflows
  [id]/
    workflow-detail.tsx       # 변경 — 빈 slot에 상태별 액션(생성·재생성·다운로드·발송) 채움
    send-modal.tsx            # 신규 — 발송(수신자·제목·본문 편집) → POST .../send
  billing/
    settings/
      page.tsx                # 신규 — 설정 페이지(서버 컴포넌트 셸 + 권한 가드)
      billing-settings.tsx    # 신규 — 연도별 계약정보 폼 + 회차표(client)
  mail-templates.ts           # 신규 — 단계별 buildSubject/buildBody 순수함수(KST·사업명 치환)
src/modules/workflows/services/tasks.ts  # 변경 — getTaskDetailView에 effectiveRecipients(작업.recipients ?? 유형.defaultRecipients) read-only 추가
prisma/seed.ts                # 변경 — NavigationItem "대금청구 설정" 등록(idempotent)
```

경계 규칙:

- UI는 `fetch`로 기존 API만 호출(`src/app/api/workflows/...`). 도메인 로직(`modules/workflows/*`) 직접 import 금지 — 라우트 경유.
- 메일 템플릿 함수(`mail-templates.ts`)는 **순수 함수**로 분리해 단위 테스트 대상으로 둔다(KST 계산·치환).
- React Query(`@tanstack/react-query`)·공용 프리미티브(`@/components/ui/*`: Button·Modal·Table·Select·Badge) 재사용. `Button`은 `asChild` 미지원 — 링크는 `<a className={buttonVariants(...)}>`.

## 4. 화면별 설계

### 4.1 대금청구 설정 — `/workflows/billing/settings`

- **연도 선택**: 기존 연도 목록(`GET config`) + "새 연도 추가". 선택 시 `GET config/[year]` + `GET config/[year]/rounds`.
- **계약정보 폼**: 사업명·계약번호·총계약금액(원)+한글·월청구액(원)+한글. 저장 `POST`(신규)/`PATCH`(수정), 삭제 `DELETE config/[year]`(회차 연쇄 삭제).
  - 금액은 정수 입력 → 백엔드 BigInt. zod 경계(`<= MAX_SAFE_INTEGER`, 월청구액 `<= MAX/12`)를 클라에서도 안내.
- **회차표(1~12)**: 회차별 제출일(date input). 저장 `PUT config/[year]/rounds/[round]`, 삭제 `DELETE .../[round]`. 회차→월분 표시.
- **권한**: `workflows.billing:configure` 없으면 페이지·메뉴 비노출(서버 가드 + API fail-closed).

### 4.2 작업 생성 모달 — 목록 화면

- 트리거: 목록 상단 `새 대금청구 작업` 버튼.
- 필드: 유형(현재 대금청구 고정/선택) + 예정일(`scheduledAt`, date).
- 제출 → `POST /api/workflows { typeId, scheduledAt }` → `201 {id}` → 상세(`/workflows/[id]`)로 이동.

### 4.3 작업 상세 액션 — `workflow-detail.tsx` 빈 slot

상태머신(`policy.ts` BILLING: `PENDING→GENERATED→SENT→HQ_REQUESTED`)에 따라 노출:

| 상태 | 노출 액션 | 호출 |
| --- | --- | --- |
| PENDING | `문서 생성` · 취소(기존) | `POST .../generate` |
| GENERATED | `재생성` · `다운로드`(개별·ZIP) · **`1단계 발송`** · 취소 | generate / `GET .../files/[fileId]`·`GET .../download` / send-modal(step1) |
| SENT | `다운로드` · **`2단계 발송`** | download / send-modal(step2) |
| HQ_REQUESTED | `다운로드` · "최종발송은 후속 단계" 안내 | download |
| CANCELLED | (액션 없음) | — |

- 기존 진행이력·생성파일·메일발송 목록·메일 재시도/확정은 유지.
- `재생성`은 GENERATED에서 다시 `generate`(백엔드가 per-request 경로·commit tx로 안전 처리).
- 다운로드: 개별 = `/files/[fileId]`(GeneratedFile.id), 전체 = `/download`(디렉터리 ZIP). `<a>` 직접 링크 또는 fetch→blob.

### 4.4 발송 모달 — `send-modal.tsx` (1·2단계 공통)

- props: `taskId`, `step`(1|2), `scheduledAt`, `kind`.
- open 시: ① `scheduledAt`으로 KST 전월·회차·projectYear 계산(D4) → ② `GET config/[projectYear]`로 사업명(D5) → ③ `mail-templates.ts`의 `buildSubject(step,…)`·`buildBody(step,…)`로 제목·본문 prefill → ④ 수신자는 detail의 `effectiveRecipients`로 prefill(D6).
- 필드: 수신자(To, 쉼표 분리, `effectiveRecipients` prefill·편집 가능, **최소 1명 필수**), 제목(text), 본문(textarea). 2단계는 "첨부 없음" 안내.
- **제출 전 검증(fail-closed, D6): To를 파싱해 빈 목록이면 검증 오류로 발송을 차단**(백엔드 폴백에 의존하지 않음). 제출 → `POST .../send { step, subject, body, recipients }` — `recipients`에 **화면에 표시된 정확한 목록을 항상 명시 포함**(생략하지 않음). 성공 시 모달 닫고 상세 refetch(React Query invalidate).
- 에러: 400(검증)·403(권한)·409(상태 충돌, 예: 이미 발송)·422(미지원 단계)·500을 sonner 토스트로 구분.

## 5. 메일 템플릿 (`mail-templates.ts`) — D3·D4

day-sync 템플릿을 포팅. `BillingConfig.projectName`·전월·회차로 치환. 예:

- **1단계 제목**: `{projectYear}년 {projectName} {prevMonth}월 대금 청구의 건`
- **1단계 본문**: 검토·승인 요청 문구(고정) + 사업명/월 치환.
- **2단계 제목**: `{projectYear}년 {projectName} {prevMonth}월 … 서류 요청의 건`
- **2단계 본문**: 국세·지방세 완납증명서, 4대보험 스캔본 요청 문구(고정).

`prevMonth`/`round`/`projectYear` 산정은 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year/month })`로 KST 캘린더 필드를 얻어 계산(전월의 월 = 회차, 전월 연도 = projectYear). 정확한 텍스트 문구는 plan 단계에서 day-sync 원문 대조로 확정.

## 6. 수신자 prefill — detail `effectiveRecipients` 노출 (확정: (나))

백엔드 `send`는 수신자 미지정 시 `작업.recipients → 유형.defaultRecipients`로 폴백하지만, 현재 `GET /api/workflows/[id]`(detail) 응답에는 수신자 필드가 없어 UI가 기본 수신자를 미리 보여줄 수 없다. 발송 모달이 기본 수신자를 prefill하도록, detail 조회 경로를 read-only로 보강한다:

- `getTaskDetailView`(`services/tasks.ts`)가 `effectiveRecipients: string[]`을 계산해 응답에 포함한다 — `WorkflowTask.recipients`가 비어있지 않으면 그것을, 아니면 `WorkflowType.defaultRecipients`, 둘 다 없으면 빈 배열(`[]`).
- 발송 모달은 이 값으로 수신자란을 prefill하고, 사용자가 편집할 수 있다. 단 **발송 모달은 항상 화면에 표시된 수신자 목록을 명시 전달하며(D6 fail-closed), To가 비면 발송을 차단한다 — 백엔드 폴백에 의존하지 않는다.** 백엔드 폴백은 수신자를 생략한 비-UI 호출자에게만 적용된다(detail read-only 노출은 prefill 재료일 뿐, 발송 시점의 신뢰 경계는 모달의 명시 목록이다).
- **read-only 노출**일 뿐 전이·쓰기 로직은 없다(D1). detail 라우트(`[id]/route.ts`)는 `getTaskDetailView` 결과를 그대로 전달하므로 변경 없음.

## 7. 권한·접근 제어

- 화면/버튼: `useCan("workflows.billing", "generate")`, `"send"`, `"configure")`. 권한 없으면 버튼·메뉴 비노출.
- API: 기존 라우트가 이미 동일 키를 `requirePermission`/`can`으로 검사(백엔드 SC-9). UI는 그 위의 UX 레이어일 뿐 — 숨김이 보안 경계가 아니다.
- 네비: `NavigationItem.requiredPermissionId = workflows.billing:configure`.

## 8. 테스트 전략 — D9

- **단위(순수함수)**: `mail-templates.ts` — 단계별 제목/본문, KST 전월·회차(서버 TZ 비KST 환경 시뮬레이션), 사업명 치환. + `getTaskDetailView`의 `effectiveRecipients` 폴백(작업 우선 → 유형 → 빈 배열).
- **컴포넌트(vitest + @testing-library/react)**: 상태별 액션 버튼 노출(상태머신 매핑), 권한 게이트(useCan mock), 설정 폼 검증(금액 경계), 발송 모달 prefill·제출 페이로드. fetch는 mock. **수신자 fail-closed(D6) 회귀 테스트**: ① 빈 To는 제출을 차단하고 검증 오류를 띄운다(send 요청이 발생하지 않음), ② 제출 시 `POST .../send` 페이로드의 `recipients`가 화면에 표시된 목록과 정확히 일치하고 생략되지 않는다.
- **통합(수동)**: 구현 중 로컬 docker PostgreSQL(`migrate deploy`·`db:seed`·`db:seed:demo`) + `STORAGE_ROOT`+`Template/대금청구` 배치 + `npm run dev`로 설정→생성→다운로드→1·2단계 클릭 검증. 머지 후 kgs-dev 배포 smoke(실데이터·SMTP·휴대폰 Tailscale).
- 기존 1568 테스트 그대로 통과(회귀 없음). `npm test`는 `.env` 주입 필요(`DATABASE_URL`).

## 9. 통합테스트(수동) 선행 조건 체크리스트

- 로컬 docker PostgreSQL 기동(`opshub` DB) + `DATABASE_URL` (이미 `localhost:5432` 지정)
- `prisma migrate deploy`(GenerationLock 포함) → `db:seed`(권한·WorkflowType BILLING·네비) → `db:seed:demo`(샘플 작업)
- `.env`에 `STORAGE_ROOT` 추가 + `$STORAGE_ROOT/Template/대금청구/`에 HWPX 템플릿 4종 배치(없으면 generate fail-closed)
- OWNER/pm 계정 로그인 → 권한 확인

## 10. 후속

- 3단계(최종발송) UI + 업로드 artifact 백엔드 계약(저장·검증·id 기반 첨부 선택) — 별도 spec.
- 주간보고·알림톡 UI — 별도 sub-project.
