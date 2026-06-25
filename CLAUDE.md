# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태 (중요)

앱이 **스캐폴드되어 동작하는 상태**입니다. Phase 0~2(실사·기준선 / 앱 골격·공통 기반 / 설정 체계), **디자인 시스템 기반**, Phase 3(통합 캘린더 `src/modules/calendar`), Phase 4(워크플로 `src/modules/workflows`), Phase 5 Leave **백엔드 + 연차 영역 재설계(UI·현황·전용 캘린더·관리자 모달·알림 메일)**, 그리고 이후 **사용자 관리(계정 수명주기)·네비게이션 CMS·사이드바 트리/아코디언·팀 + 권한 매트릭스·공용 UI 프리미티브·관리 콘솔 재디자인(Aurora)·통합/연차 캘린더 통일(`CalendarMonth`)**까지 `main`에 머지된 상태입니다(최신 머지: PR #22 캘린더 통일, `91d808b`, 2026-06-25). **현재 진행 중인 feature 브랜치는 없습니다(main clean).** 새 작업을 시작·확인할 때는 git 브랜치 + `docs/plans/`의 최신 plan을 보세요.

이미 존재하는 것:

- `src/` — 동작하는 Next.js App Router 앱: `app/`(라우트·`api`), `kernel/`(access·navigation·settings·events 등 공통), `lib/`(auth·prisma 등), `components/`(`ui/` 프리미티브·테마), `modules/`, `middleware.ts`
- `prisma/` — `schema.prisma` + **마이그레이션**(`migrations/`) + `seed.ts`/`seed-permissions.ts`
- `tests/` — vitest 스위트(`src/` 레이아웃 미러)
- `docs/` — 아키텍처/ADR/spec/plan/discovery/마이그레이션/로드맵 문서
- 루트 설정: `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`(boundaries), `vitest.config.ts`, `package.json`

따라서 `npm run lint` / `typecheck` / `build` / `test`가 **모두 동작**합니다(아래 명령어). "코드가 아직 없다"고 가정하지 마세요.

## 명령어

```bash
npm install

# 개발·검증 (모두 동작)
npm run dev                 # next dev (Turbopack)
npm run build               # 프로덕션 빌드
npm run lint                # eslint src (boundaries 포함)
npm run typecheck           # tsc --noEmit
npm test                    # vitest run

# Prisma
npm run prisma:validate     # 스키마 검증
npm run prisma:generate     # Prisma Client 생성
npm run prisma:migrate      # prisma migrate dev (PostgreSQL 필요)
npm run prisma:studio
npm run db:seed             # prisma db seed (prisma/seed.ts)
```

DB는 PostgreSQL입니다(SQLite 아님). 로컬 연결 문자열 등 환경변수는 `.env.example` 참고. `lint`/`typecheck`/`build`/`test`는 DB 없이 동작하고, `dev`/`db:seed`/`prisma:migrate`는 DB(로컬 또는 터널) 연결이 필요합니다.

## 이 프로젝트가 무엇인가

`ops-hub`는 두 POC를 **물리적으로 합치는 것이 아니라 재설계해 통합**하는 내부 업무 운영 허브입니다.

- `day-sync` (Next.js 16, Prisma SQLite, NextAuth) → 업무 자동화(문서 생성·메일·Google 연동)와 앱 구조를 **계승**
- `annual-leave` (Next.js 14 + Express, JWT, SQLite) → 연차 **도메인 규칙과 데이터 모델만** 포팅. Express 백엔드·JWT/localStorage 인증은 **이식하지 않음**
- `knowledge-graph-studio` → 흡수하지 않고 별도 서비스로 유지(포털 링크/상태 카드/프록시 수준의 연계만)

핵심 원칙(AGENTS.md, ADR-0001): POC 폴더를 통째로 복사하지 말고, 검증된 도메인 동작만 테스트·마이그레이션과 함께 의도적으로 포팅한다.

## 아키텍처

Next.js App Router 기반 **모듈형 모놀리스**. 계층은 day-sync에서 계승:

```
Route Handler -> Service -> Repository -> Prisma
```

도메인이 늘어나므로 service/repository를 루트에 쌓지 말고 모듈별로 묶습니다:

```
src/modules/<domain>/{services,repositories,validations}/
  workflows/   leave/   calendar/   admin/   integrations/
src/lib/{auth,prisma,api,validation}/
src/app/{(auth),dashboard,workflows,leave,admin,api}/
```

모듈 경계:

| 모듈 | 책임 |
| --- | --- |
| `workflows` | 주간보고·대금청구·알림톡 문서 생성, 메일 발송 (day-sync의 `TaskType`/`Task` → `WorkflowType`/`WorkflowTask`로 개명) |
| `leave` | 연차 신청·승인·할당·이력 (annual-leave 도메인) |
| `calendar` | 여러 출처를 권한에 맞게 합성하는 도메인 (단일 화면이 아님) |
| `admin` | User·Role·Permission·SystemSetting·AuditLog |
| `integrations` | Google Sheets/Calendar, SMTP, LibreOffice, Anthropic, 템플릿/출력 파일 |

연차 상태값과 업무 자동화 상태값은 섞지 않습니다.

## 디렉터리 규약

저장소 최상위는 다음 6개를 표준으로 둡니다:

| 디렉터리 | 용도 | git |
| --- | --- | --- |
| `src/` | 애플리케이션 코드 (모듈·커널·앱·lib) | 추적 |
| `docs/` | 문서 — **비즈니스 진실(SSOT)** | 추적 |
| `tests/` | 테스트 (`src/` 레이아웃을 미러) | 추적 |
| `scripts/` | 운영·개발 보조 스크립트 (마이그레이션·시드·일회성 도구) | 추적 |
| `.dev/` | AI 작업 흔적 — 로그·학습·스크래치 (일회성) | **무시** |
| `out/` | 생성 산출물 (문서/엑셀/PDF 등) | **무시** |

- 도구·관례상 최상위에 함께 두는 예외(5종 규약을 강제하지 않음): `prisma/`(Prisma 기본 경로), `.claude/`(스킬·설정·메모리), `.remember/`(세션 핸드오프), `node_modules/`, 루트 설정 파일(`package.json`, `tsconfig.json`, `next.config.*` 등).
- `docs/` 하위 문서 구획: 설계 스펙은 `docs/specs/`, 구현 계획은 `docs/plans/`, 결정 기록(ADR)은 `docs/adr/`에 둔다. 이들은 일회성 스크래치가 아니라 **추적되는 설계·계획·결정 기록**이므로 `docs/`에 둡니다(`.dev/` 아님). ADR은 파일이 늘면 `docs/adr/`에서 번호순으로 관리한다. (이전 `docs/superpowers/specs|plans` 경로에서 이전됨)
- 배포 시 서버 shared 스토리지(`Template/`, `keys/`, 산출물)는 릴리즈와 분리합니다 — `docs/architecture.md` 배포 섹션. 저장소 기준 산출물 디렉터리 이름은 `out/`로 통일합니다(기존 문서의 `output` 표기는 서버 런타임 경로 맥락).

## 접근 제어 (이 프로젝트의 핵심 설계 — `docs/architecture/access-control.md`)

단순 `ADMIN/MEMBER` enum이 아니라 **속성 + RBAC 테이블** 조합입니다.

- 사용자 속성: `employmentType`(REGULAR/CONTRACTOR), `jobFunction`(PM/DEVELOPER/CONTENT_MANAGER/CIVIL_RESPONSE) — 초기 role 자동 부여와 화면 필터링용
- coarse role: `systemRole`(OWNER/ADMIN/MANAGER/MEMBER)
- 세부 권한: `AccessRole` × `Permission`(`resource:action`) × `RolePermission`(effect/scope/conditions)
- 예외: `UserPermissionOverride` (유효기간 있는 ALLOW/DENY)
- 메뉴: `NavigationItem.requiredPermissionId`

권한 계산 규칙(반드시 지킬 것):

1. **메뉴 숨김은 UX일 뿐, API도 같은 permission key를 검사해야 한다.** UI `useCan(...)`와 서버 `requirePermission(...)`가 동일 키를 공유해 노출/실행이 어긋나지 않게 한다.
2. **Deny 우선, 기본 거부(fail-closed).** 우선순위: OWNER 허용 → override DENY → override ALLOW → role DENY → role ALLOW → 기본 거부.
3. 권한 목록 전체를 세션에 넣지 않는다. 세션엔 user id/systemRole/employmentType/jobFunction만, permission summary는 별도 API.

## 캘린더 (`docs/architecture/calendar-design.md`)

여러 출처를 합성하고 권한별로 다시 마스킹하는 도메인. 출처 권위가 명확히 정의됨:

- `LeaveRequest` — ops-hub 도입 이후 **휴가/근태의 기준 데이터**
- `WorkflowTask` — 업무 일정의 기준 데이터
- Google Calendar — 전환기 외부/보조 데이터. 내부 승인 휴가와 겹치면 **내부 휴가 우선**, 외부는 `DUPLICATE_OF_INTERNAL`로 표시
- 공휴일 — 영업일 계산·표시

설계 포인트: 단일 feed API(`GET /api/calendar/feed?view=work|leave|personal|team|admin&start&end`)가 권한·뷰에 따라 다른 응답(`events/sources/staleSources/failedSources`) 생성. 권한 없으면 제목을 "휴가/부재/외부 일정"으로 마스킹. DB 캐시 기본(공휴일 24h, Google 5~15분 stale-while-revalidate), 외부 API 실패가 화면 전체를 막지 않도록 부분 실패 허용.

## 데이터 규약 (schema.prisma)

- 금액 = `BigInt`, 연차 일수 = `Decimal(6,2)`
- `Json` 컬럼은 통합 페이로드에 한정: 수신자 목록, 설정, audit metadata, 권한 conditions. 그 외에는 명시적 도메인 모델 선호(AGENTS.md)
- 생성 파일은 DB에 **경로와 메타데이터만**, 실제 파일은 shared storage(`output`/`Template`/`keys`)에 — git 미포함, 릴리즈와 분리
- 워크플로 상태 전이: `PENDING → GENERATED → REVIEWED → SENT → HQ_REQUESTED → FINAL_SENT` (+ `CANCELLED`)
- 메일은 leave·workflows가 **공통 `MailDelivery`(workflows 스키마)** 사용. `MailDeliveryStatus` enum에 값 추가 시 **workflow 소비자도 갱신 필수** — `src/app/(app)/workflows/labels.ts`의 `MailStatus`·`MAIL_LABEL`·`MAIL_VARIANT`가 손수 작성 좁은 union이라 누락하면 typecheck/렌더가 깨진다.

연차 도메인 불변식(`docs/discovery/annual-leave-analysis.md`):

- `LeaveAllocation.usedDays`는 **캐시 필드**. 승인/취소/관리자 수정/삭제는 반드시 **transaction**으로 처리하고, 별도 `recalculate` 작업을 둔다
- 연차 상태 전이(approve/cancel/reject/관리자 수정·삭제)는 read 후 `updateMany({where:{id,status}})` **status-CAS + count===0 충돌** 패턴(기존 `src/modules/leave/repositories/index.ts` approveTx/cancelTx). 동시 관리자 수정(days 변경)까지 막으려면 `where`에 `updatedAt` 낙관적 락을 추가 — stale read로 usedDays가 어긋나는 것 방지
- 같은 기간 `PENDING`/`APPROVED` 신청과 중복 불가. 일반 사용자는 과거 날짜 신청·당일/과거 취소 불가(관리자는 가능)
- `createLeaveRequest`는 신청 기간이 걸친 연도의 **공휴일 동기화 후에만 통과**(fail-closed). 동기화엔 `DATA_GO_KR_SERVICE_KEY` 필요 — **없으면 유형 무관 모든 신청이 차단**된다(spec D8). 교차연도 ANNUAL은 **시작연도에 전체 일수 일괄 차감**(spec D7, 연도별 분할 아님)
- 메일 발송은 업무 성공과 분리(background)하되 `MailDelivery` 이력으로 남긴다

## 코딩 규칙 (AGENTS.md)

- **문서·짧은 주석은 한국어, 식별자·파일명·코드 레벨 이름은 영어.**
- UI 프리미티브 `Button`(`src/components/ui/button.tsx`)은 `asChild` **미지원**(native button props만) — 링크를 버튼처럼 쓰려면 `<a className={buttonVariants({...})}>`.
- 변경은 surgical하게, 로컬 구조에 맞춘다. 안 망가진 것을 리팩터링하지 않는다.
- 스키마가 실행 준비되면 Prisma migration으로 추가한다.

## 작업 진행 맥락

전체 계획은 `docs/product/modernization-roadmap.md`의 Phase 0~6. **Phase 0~5(Leave 백엔드 + 연차 UI 재설계)와 이후 관리·UX·캘린더 개선(사용자 관리·네비 CMS·팀/권한 매트릭스·공용 프리미티브·Aurora 관리 콘솔·캘린더 통일)**까지 모두 `main`에 머지됐고, **현재 활성 feature 작업은 없습니다(main clean)**. 남은 큰 미완 단계는 **Phase 6 데이터 마이그레이션 + 운영 cutover**(기존 SQLite annual-leave → PostgreSQL, `172.21.10.27:3000`으로 이전)이며, day-sync 주간보고는 단순 포팅이 아니라 다중 직무 보고 시스템으로 별도 재설계 예정입니다. 마이그레이션 시 기존 운영 DB는 직접 수정하지 않고(이메일을 사용자 병합 키로 사용) 새 PostgreSQL에 적재 후 병행 검증한다 — `docs/migration/initial-migration-plan.md`.

확장·분리 아키텍처 전략(모듈 경계·이벤트·신원 연동)은 `docs/specs/2026-06-17-modular-extensibility-design.md` 참조.

## 구현 계획 작성

이 저장소의 다단계 구현 계획은 글로벌 `superpowers:writing-plans` 대신 **`dev-workflow:writing-plans-split`** 스킬(dev-workflow 플러그인 제공, `.claude/settings.json`의 `enabledPlugins`로 활성화)로 작성한다 — 단일 대형 파일이 아니라 얇은 엔트리포인트 `docs/plans/<feature>.md` + 태스크별 파일(`<feature>/task-NN-<slug>.md`)로 분할한다. brainstorming의 종착점이 "writing-plans 호출"이어도 이 저장소에서는 이 스킬을 사용한다. 실행은 `superpowers:subagent-driven-development`로 한다.

완료된 `task-NN` plan 파일은 historical record로 **동결**한다(본문 수정 금지=plan churn). 정책이 바뀌면 SSOT(SKILL·구현물)만 갱신하고 plan 상단에 포인터 1줄만 둔다.

## 개발 사이클 자동화 (적대검증 반복 루프)

각 단계(spec/plan/impl) 완료 후 **`dev-workflow:review-loop`** 스킬(dev-workflow 플러그인 제공)로 "커밋→codex 적대검증→보수적 판정(disposition)·자동수정→재반복(미판정 blocking 0까지/최대 5회)"을 돌린다. 목표는 "high 0"이 아니라 "판정 없이 남은 high 0" — 모든 critical/high/medium을 FIXED/ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE/DUPLICATE/ESCALATE로 닫는다. 단계 경계(spec→plan, plan→impl)는 **반드시 새 세션**에서 시작한다(핸드오프 작성 후 `/clear`). 컨텍스트 40% 초과 시 dev-workflow 플러그인의 Stop 훅이 핸드오프+`/clear`를 넛지한다. 자가 `/clear`·자동 단계전환은 불가하므로 실제 초기화는 사람이 한다. 상세: `docs/workflow/review-loop-runbook.md`.

**codex 적대검증은 `docs/specs/`의 결정(번호 `D<n>`)·사용자 기결정·pre-existing 코드를 모른다** — 의도된 설계를 버그로 재지목할 수 있다. finding을 고치기 전 해당 spec 결정과 대조하고, 오탐/이미-결정은 자동수정 말고 ESCALATE·기록으로 처리한다(수렴 안 하면 diminishing-returns 신호).

**두 세션 동시 작업 git 위생:** 같은 워킹트리를 구현 세션 + 보조 세션이 공유할 수 있다(실제 `index.lock` 충돌 발생). 커밋 전 `.git/index.lock` 존재를 확인하고, `git add -A` 대신 **변경 파일을 명시적으로 stage**해 다른 세션의 미커밋 작업과 섞이지 않게 한다.

**PR 머지/편집:** 머지 전 `git rev-parse origin/<branch>`이 local HEAD와 일치하는지 확인한다(두 노트북·review-loop가 로컬에만 커밋을 쌓아, 미push 시 **옛 상태가 머지**된다). `gh pr edit`/`gh pr merge`(GraphQL)는 토큰에 `read:project` 스코프가 없으면 실패 → `gh api` REST로 우회(`-X PATCH repos/{owner}/{repo}/pulls/N -F body=@file` / `-X PUT repos/{owner}/{repo}/pulls/N/merge -f merge_method=merge`). 머지 컨벤션 = merge commit.

## dev 테스트 배포 (수동 — 배포 스크립트 없음)

접속·경로·포트·DB는 workspace-env `INVENTORY.md`(SSOT) 참조. 절차: 대상 브랜치 checkout → `.env` 보강 → `npm ci` → `npx prisma migrate deploy` → `npm run db:seed`(새 권한 catalog 등록) → `npm run db:seed:demo`(테스트 데이터) → `npm run build` → `pm2 restart ops-hub`. **마이그레이션 대상은 우리 `opshub` DB — 같은 서버에 동거하는 safety_report 운영 DB는 절대 건드리지 말 것.** `psql "$DATABASE_URL"`은 Prisma 전용 `?schema=public`를 제거해야 동작한다.

- `npm ci`는 postinstall이 없어 Prisma client를 재생성하지 않는다 → migrate/build 전에 `npm run prisma:generate` 명시 실행(스키마 변경 시 필수).
- **비가역 마이그레이션(컬럼 drop 등)은 `pm2 restart` 금지 — full-stop:** build → `pm2 stop` → DB 백업(`pg_dump`) → `prisma migrate deploy` → `db:seed`(+`db:seed:demo`) → smoke → `pm2 start`. rolling 시 old 바이너리가 drop된 컬럼을 참조해 outage.
- `psql`/`pg_dump`의 SQL 문자열 리터럴은 SSH 단일따옴표 명령 안에서 `$$..$$` 달러 인용(중첩 작은따옴표·`\x27` 미작동).
