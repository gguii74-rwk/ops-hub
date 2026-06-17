# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태 (중요)

이 저장소는 **아직 실행 앱이 스캐폴드되지 않은 설계 기준선**입니다. Phase 0(실사·스키마·마이그레이션 계획)이 끝난 상태이며, 존재하는 것은 다음뿐입니다.

- `docs/` — 아키텍처/ADR/discovery/마이그레이션/로드맵 문서
- `prisma/schema.prisma` — 도메인 모델 초안 (migration 없음)
- `package.json` — 의존성과 스크립트 정의

`src/`, `app/`, `tsconfig.json`, `next.config.*`, `prisma/migrations/`는 **아직 없습니다.** 따라서:

- 지금 동작하는 검증: `npm run prisma:validate`
- 앱 스캐폴드(`src/`, `tsconfig.json`, `next.config`) 생성 전까지 `npm run lint` / `typecheck` / `dev` / `build`는 실패합니다.

새 작업을 시작할 때 "이미 코드가 있다"고 가정하지 말고, 위 상태를 전제로 판단하세요.

## 명령어

```bash
npm install
npm run prisma:validate     # 스키마 검증 — 현재 유일하게 의미 있는 검증
npm run prisma:generate     # Prisma Client 생성
npm run prisma:migrate      # prisma migrate dev (PostgreSQL 필요)
npm run prisma:studio

# 앱 스캐폴드 이후에만 동작:
npm run dev / build / start
npm run lint                # eslint src
npm run typecheck           # tsc --noEmit
```

DB는 PostgreSQL입니다(SQLite 아님). 로컬 연결 문자열 등 환경변수는 `.env.example` 참고.

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

연차 도메인 불변식(`docs/discovery/annual-leave-analysis.md`):

- `LeaveAllocation.usedDays`는 **캐시 필드**. 승인/취소/관리자 수정/삭제는 반드시 **transaction**으로 처리하고, 별도 `recalculate` 작업을 둔다
- 같은 기간 `PENDING`/`APPROVED` 신청과 중복 불가. 일반 사용자는 과거 날짜 신청·당일/과거 취소 불가(관리자는 가능)
- 메일 발송은 업무 성공과 분리(background)하되 `MailDelivery` 이력으로 남긴다

## 코딩 규칙 (AGENTS.md)

- **문서·짧은 주석은 한국어, 식별자·파일명·코드 레벨 이름은 영어.**
- 변경은 surgical하게, 로컬 구조에 맞춘다. 안 망가진 것을 리팩터링하지 않는다.
- 스키마가 실행 준비되면 Prisma migration으로 추가한다.

## 작업 진행 맥락

전체 계획은 `docs/product/modernization-roadmap.md`의 Phase 0~6. 현재 Phase 0 완료, 다음은 **Phase 1(앱 골격 + 공통 인증/권한/감사 기반)**. 마이그레이션 시 기존 운영 DB는 직접 수정하지 않고(이메일을 사용자 병합 키로 사용) 새 PostgreSQL에 적재 후 병행 검증한다 — `docs/migration/initial-migration-plan.md`.

확장·분리 아키텍처 전략(모듈 경계·이벤트·신원 연동)은 `docs/specs/2026-06-17-modular-extensibility-design.md` 참조.

## 구현 계획 작성

이 저장소의 다단계 구현 계획은 글로벌 `superpowers:writing-plans` 대신 프로젝트 스킬 **`writing-plans-split`**(`.claude/skills/writing-plans-split/`)으로 작성한다 — 단일 대형 파일이 아니라 얇은 엔트리포인트 `docs/plans/<feature>.md` + 태스크별 파일(`<feature>/task-NN-<slug>.md`)로 분할한다. brainstorming의 종착점이 "writing-plans 호출"이어도 이 저장소에서는 이 스킬을 사용한다. 실행은 `superpowers:subagent-driven-development`로 한다.
