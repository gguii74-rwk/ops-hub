# ops-hub 고도화 로드맵

## 목표

`ops-hub`는 단순한 POC 병합이 아니라 내부 업무 운영 플랫폼으로 설계합니다.

초기 범위:

- `day-sync` 업무 자동화
- `annual-leave` 연차 관리
- 공통 사용자/권한/설정/감사 로그
- 통합 캘린더

제외:

- `knowledge-graph-studio` 기능 흡수

## 제품 원칙

1. 업무별 기능은 모듈로 분리한다.
2. 사용자는 한 번 로그인하고 모든 업무를 본다.
3. 설정은 화면에서 관리하고, secret만 환경/파일로 둔다.
4. 캘린더는 빠르게 열려야 하며 외부 API 실패가 전체 화면을 막지 않아야 한다.
5. 문서 생성/메일 발송은 이력과 재시도가 가능해야 한다.
6. 관리자 변경은 감사 로그로 남긴다.

## 정보 구조

```text
Dashboard
  오늘 할 일
  승인 대기
  최근 생성 문서
  외부 연동 상태

Calendar
  업무 일정
  연차 일정
  Google Calendar
  공휴일

Workflows
  주간보고
  대금청구
  알림톡

Leave
  내 연차
  팀 캘린더
  신청 이력

Admin
  사용자
  연차 승인
  연차 할당
  업무 설정
  연동 설정
  감사 로그
```

## Phase 0: 실사와 기준선

목표:

- 기존 프로젝트 분석 문서화
- PostgreSQL 스키마 초안 작성
- 마이그레이션 전략 수립

산출물:

- `docs/discovery/day-sync-analysis.md`
- `docs/discovery/annual-leave-analysis.md`
- `docs/discovery/knowledge-graph-studio-boundary.md`
- `prisma/schema.prisma`
- `docs/migration/initial-migration-plan.md`

## Phase 1: 앱 골격과 공통 기반

목표:

- Next.js 앱 스캐폴드
- PostgreSQL 연결
- NextAuth Credentials
- 공통 layout/navigation
- 사용자 속성 + 역할/권한 테이블 기반 접근 제어
- AuditLog 기반

완료 기준:

- 로그인/로그아웃 가능
- `/dashboard`, `/calendar`, `/workflows`, `/leave`, `/admin` 보호
- Prisma migration 실행 가능
- seed admin 생성 가능
- 초기 permission matrix seed 가능

## Phase 2: 설정 체계 정리

목표:

- 설정 파편화 제거
- secret과 운영 설정 분리
- 설정 검증 UI 제공

설정 분류:

| 분류 | 예 |
| --- | --- |
| Secret/runtime env | DATABASE_URL, NEXTAUTH_SECRET, API key 경로 |
| DB setting | calendar list, recipients, template mapping, billing config |
| Filesystem state | Template, output, keys |

관리 화면:

- Google service account 상태
- Google Sheet ID 검증
- Google Calendar 목록 관리
- SMTP 테스트
- LibreOffice 경로 검증
- 템플릿 파일 검증
- output 경로 쓰기 검증

## Phase 3: 통합 캘린더와 캐시

목표:

- 빠른 캘린더
- 업무/연차/외부 일정 통합
- 연차 시스템과 Google Calendar 휴가의 중복 제거
- 업무 중심 캘린더와 휴가/근태 캘린더의 분리
- 부분 실패 허용

API:

```text
GET /api/calendar/feed?view=work|leave|personal|team|admin&start&end
```

응답:

```text
events
sources
staleSources
failedSources
```

출처 권위:

- `LeaveRequest`: ops-hub 도입 이후 휴가/근태의 기준 데이터
- `WorkflowTask`: 업무 일정의 기준 데이터
- Google Calendar: 전환기 외부 휴가와 개인/팀 외부 일정
- 공휴일 캘린더: 영업일 계산과 휴일 표시

캐시 전략:

- 공휴일: DB 캐시 24시간
- Google Calendar: DB 캐시 5~15분
- workflow/leave: DB 직접 조회 + 적절한 index
- 클라이언트: React Query stale cache

UX:

- 업무, 휴가/근태, 개인, 팀, 관리자 뷰 분리
- 권한이 없는 휴가 사유와 개인 일정 제목 마스킹
- 이전 데이터 유지
- 소스별 로딩 표시
- 수동 새로고침
- 실패한 calendar source 표시
- 월 이동 prefetch

## Phase 4: Workflows 포팅

목표:

- `day-sync`의 업무 자동화 기능 이식
- 상태 전이와 이력 명확화

작업:

- WorkflowType/WorkflowTask 포팅
- 주간보고 생성 포팅
- 대금청구 생성 포팅
- 알림톡 생성 포팅
- GeneratedFile 모델 적용
- MailDelivery 이력 적용
- 단계형 작업 상세 UI

## Phase 5: Leave 포팅

목표:

- `annual-leave` 도메인 이식
- 기존 Express/JWT 제거

작업:

- LeaveRequest API
- LeaveAllocation API
- 승인/반려 UI
- 관리자 직접 입력
- 팀 캘린더
- 연차 요약
- 연차 정합성 검증 작업

## Phase 6: 데이터 마이그레이션

목표:

- 기존 SQLite DB에서 PostgreSQL로 이관
- 병행 검증 후 전환

검증:

- 사용자 수
- 업무 task 수
- 연차 신청 수
- 연차 할당 수
- 승인 대기 수
- 월별 캘린더 결과
- 생성 파일 경로 접근

## 주요 설계 결정 — 현황 (2026-06-25 기준)

초기에 열어둔 8개 결정의 현재 상태. ✅=결정·구현됨, 🔶=방향 확정·일부 잔여, ⏳=미결(주로 운영 cutover 시점).

| # | 결정 항목 | 상태 | 결론 / 근거(SSOT) |
| --- | --- | --- | --- |
| 1 | 비밀번호 해시 이전 vs 전체 재설정 | ✅ | bcrypt 동일 알고리즘이라 **해시 그대로 이전**(재로그인 가능). dev에 운영 16명 적재로 검증. `docs/migration/initial-migration-plan.md` |
| 2 | PM 단일 `OWNER` vs 복수 `OWNER` | ✅ | **복수 OWNER 허용 + 최소 1 OWNER 보존.** PM `AccessRole`(`"*"`)과 OWNER `systemRole`을 분리. 권한상승 가드(비-OWNER는 OWNER/ADMIN 부여 불가, 마지막 OWNER 강등·비활성 거부 — spec D12/D14). `docs/specs/2026-06-21-user-management-account-admin-design.md` |
| 3 | 정규/외주·직무별 초기 permission matrix 범위 | ✅ | `prisma/seed-roles.ts`의 `ROLE_ALLOW`가 구체 매트릭스(초안의 "제한" 항목 확정 — 예: 정규 개발자 대금청구는 view만, 알림톡 send는 어떤 역할에도 미부여). OWNER가 매트릭스 편집기(PR #15·#19)로 조정. `docs/architecture/access-control.md` |
| 4 | 부서별 승인자 모델 | ✅ | `department` 문자열 폐기, **`Team` 모델 신설**(1인 1팀 `User.teamId`) + `scope=team` 능력. 팀 단위 승인(`leave.approval` team scope)은 기본 미부여, OWNER가 편집기로 부여. PR #15 |
| 5 | Google Calendar 개인별 vs 시스템 공통 | 🔶 | 모델이 **둘 다 지원**(`CalendarSource.ownerUserId`·`visibility`). 현재 시드는 시스템 공통 `holiday-kr` 1개뿐 — 개인/업무 Google 캘린더 실제 연동은 미완(휴가는 내부 `LeaveRequest`가 대체). `docs/architecture/calendar-design.md` |
| 6 | 캘린더 DB 캐시 TTL | ✅ | 공휴일 24h, Google 5~15분 stale-while-revalidate(`CalendarSource.cacheTtlSeconds` 기본 900). `docs/architecture/calendar-design.md` |
| 7 | 파일 저장 위치 `/NAS/ops-hub/output` | 🔶 | shared storage(`output`/`Template`/`keys`)를 릴리즈와 **분리**하는 원칙 확정. 정확한 NAS 마운트 절대경로는 운영 cutover 시 확정(dev는 `/home/kgs/apps/ops-hub`). `docs/architecture.md` 배포 방향 |
| 8 | `day-sync` 운영 DB read-only 전환 시점 | ⏳ | **미결** — Phase 6 데이터 마이그레이션·운영 cutover 시점에 결정. |
