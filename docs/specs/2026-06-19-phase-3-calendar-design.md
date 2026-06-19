# Phase 3 — 통합 캘린더와 캐시 설계 스펙

- 작성일: 2026-06-19
- 상태: 설계 확정(구현 계획 작성 직전)
- 선행: `docs/architecture/calendar-design.md`(도메인 설계), `docs/product/modernization-roadmap.md` Phase 3
- 후속: 본 스펙 → `writing-plans-split` 구현 계획(`docs/plans/phase-3-calendar.md` + 태스크 파일)

## 1. 배경과 목표

통합 캘린더는 단일 화면이 아니라 **여러 출처를 권한별로 합성·마스킹하는 도메인**이다. Phase 0/1에서 스키마(`CalendarSource`/`CalendarEvent`/`CalendarCacheEntry` + enum)와 access 카탈로그(`calendar.work|leave|personal|team|admin`)가 이미 깔려 있으므로, Phase 3는 **모델이 아니라 합성 엔진·feed API·캐시·마스킹·UI**를 짓는 단계다.

목표:

- `GET /api/calendar/feed`가 view·기간·권한에 따라 다른 응답을 만든다.
- 외부(Google·공휴일)는 실연동 + DB 캐시로 빠르게 열리고, 외부 실패가 화면 전체를 막지 않는다.
- 내부(휴가·업무)는 권위 테이블을 캐시 없이 직접 조회한다.
- 권한 없는 정보는 서버에서 마스킹한다.

## 2. 범위

**IN**

- 합성 엔진 + `GET /api/calendar/feed`(5개 view 파라미터 모두 수용, **UI는 work/leave/personal 3뷰 노출**)
- **직접 조회 하이브리드**: 내부(leave/workflow)는 권위 테이블 직접 조회, 외부(Google)·공휴일은 캐시
- Google(service account, 시스템 공통 `integrations.google.calendarIds`) 실연동 + 캐시
- 공휴일: **Google 공휴일 캘린더 재사용**(새 secret 없이 기존 service account 경로)
- 비파괴 중복 제거(내부 휴가 우선), 권한별 필드 마스킹
- 커스텀 경량 UI(월 그리드 + 뷰 탭), 수동 새로고침
- `POST /api/calendar/refresh`(범위 한정 캐시 무효화)

**OUT(의도적 연기)**

- 승인 시 `INTERNAL_LEAVE` 생성 등 **write-time projection → Phase 5**, `WorkflowTask` 이벤트 emit → **Phase 4**
- **team·admin UI 뷰**(엔진/마스킹/권한 매핑은 지금 일반화, UI만 후속)
- Google write-back(승인 휴가를 Google에 역기록)
- 워커 기반 **비차단 백그라운드 SWR**(스케줄러/디스패처 도입 Phase로)
- 전역 Google 캐시 강제 갱신(admin 성격, admin 뷰와 함께)
- dedup 결과 영속화(in-memory 계산만; admin 뷰 도입 시 영속화 검토)

**전제**

- Phase 5(신청 플로우)·Phase 6(마이그레이션) 전까지 leave/workflow 뷰는 **seed 데이터**를 렌더한다. 직접 조회 하이브리드라 실데이터가 테이블에 들어오는 순간 캘린더 수정 없이 자동 반영된다.
- **스키마 변경 없음**(기존 모델·enum·인덱스 사용). 부득이 인덱스 추가가 필요하면 그때 prisma migration.

## 3. 출처별 권위(요약)

| 출처 | 권위 | Phase 3 처리 |
| --- | --- | --- |
| `LeaveRequest` | 휴가/근태 기준 | 캐시 없이 직접 조회. APPROVED는 확정 부재, PENDING은 잠정(`tentative` — 본인·admin만, dedup 앵커 아님, §10) |
| `WorkflowTask` | 업무 일정 기준 | 캐시 없이 직접 조회 |
| Google Calendar | 외부/전환기 보조 | service account fetch → DB 캐시 |
| 공휴일(Google holiday cal) | 외부 기준 | fetch → DB 캐시(24h) |
| 수동 일정 | 보조 | `CalendarSourceKind.MANUAL` 소스의 `CalendarEvent` 직접 조회. PERSONAL_EVENT은 **조회 단계에서 본인만**(admin 전체), TEAM_EVENT은 전원(§9) |

원칙은 `calendar-design.md`를 따른다: 내부 승인 휴가가 Google 휴가성 일정과 겹치면 **내부 우선**, 외부는 `DUPLICATE_OF_INTERNAL`로 접는다.

## 4. 아키텍처

계층은 프로젝트 표준 `Route Handler → Service → Repository → Prisma`를 따른다.

```
src/modules/calendar/
  feed/          # 합성 오케스트레이션(service): view+range+permission → FeedResponse
  sources/       # provider별 어댑터: internalLeave · workflowTask · google · holiday · manual
  repositories/  # 권위 테이블·CalendarEvent·CalendarCacheEntry 조회/기록 (Prisma는 여기서만)
  masking/       # 권한별 이벤트 필드 마스킹
  dedup/         # 내부휴가 vs 외부 휴가성 비파괴 중복 판정
  cache/         # CalendarCacheEntry read/write + TTL + range 정규화
  types.ts       # 공통 CalEvent DTO, FeedResponse, SourceStatus, ViewKey
src/lib/integrations/google/   # googleapis 클라이언트(service account): 인터페이스 + 실구현 + fake
src/app/api/calendar/feed/route.ts
src/app/api/calendar/refresh/route.ts
src/app/(app)/calendar/        # 커스텀 월 그리드 + 뷰 탭(client)
```

### 4.1 모듈 경계(boundaries) — 중요

`eslint.config.mjs`의 `boundaries/element-types`는 **모듈이 kernel·lib·자기 자신 모듈만** import하도록 강제한다(타 모듈 import 금지).

- 따라서 `calendar`는 `leave`/`workflows` 모듈 코드를 import하지 않는다.
- **권위 테이블 읽기는 `calendar` 모듈이 소유한 repository**가 `@/lib/prisma`로 직접 수행한다(`prisma.leaveRequest`/`prisma.workflowTask`). cross-domain 읽기는 **DB 레벨에서만** 일어나고 모듈 import 결합은 없다.
- provider는 Prisma를 직접 잡지 않고 **calendar repository만** 호출한다.
- Google 클라이언트는 `src/lib/integrations/google`(lib)에 두어 모듈이 import 가능하게 한다.
- **경계 부채(명시)**: Phase 4/5에서 leave/workflow service가 생기면, 권위 읽기를 그 모듈의 read-API로 옮길지 재검토한다. Phase 3에서는 boundaries 제약상 calendar-owned 읽기가 정답이다.

## 5. 공통 타입

```ts
// 표시 단위 이벤트(서버에서 마스킹까지 끝난 형태)
interface CalEvent {
  id: string;
  kind: CalendarEventKind;       // 스키마 enum 재사용
  title: string;                 // 마스킹 적용 후 최종 제목
  description: string | null;    // 권한 없으면 null
  start: string;                 // ISO, KST 기준(§11)
  end: string;                   // ISO, 반열림 종료
  allDay: boolean;
  userId: string | null;
  sourceKey: string;             // 어느 출처인지(UI 색/그룹용)
  dedupStatus: CalendarDedupStatus;
  masked: boolean;               // UI가 요약 칩으로 표시할지
  tentative: boolean;            // 잠정(미승인) 일정 — 본인/admin만 받고, UI가 별도 스타일로 표시
}

type ViewKey = "work" | "leave" | "personal" | "team" | "admin";

interface SourceStatus {
  key: string;                   // CalendarSource.key 또는 내부 출처 식별자
  state: "ok" | "stale" | "failed";
  lastFetchedAt: string | null;  // 외부 출처만
  error: string | null;          // failed/stale 사유(운영자용, 민감정보 제외)
}

interface FeedResponse {
  events: CalEvent[];
  sources: SourceStatus[];
  staleSources: string[];        // last-good 반환된 출처 key
  failedSources: string[];       // last-good 없이 실패한 출처 key
}
```

## 6. 출처 provider 계약

```ts
interface CalendarSourceProvider {
  key: string;
  // google/holiday는 내부에 N개 캘린더가 있어 출처별 statuses가 여러 개일 수 있다.
  fetchEvents(range: NormalizedRange, ctx: FeedContext): Promise<{ events: RawEvent[]; statuses: SourceStatus[] }>;
}
```

- `internalLeave` / `workflowTask`: calendar repository로 권위 테이블 직접 조회 → `RawEvent` 매핑. 조회 실패는 해당 출처 `failed`로 격리(다른 출처에 영향 없음).
- `google` / `holiday`: **cache-first**(§12). 만료 시 인라인 재fetch, 실패 시 last-good 또는 빈 결과 + failed.
- `manual`: `CalendarSourceKind.MANUAL` 소스의 `CalendarEvent` 직접 조회. **PERSONAL_EVENT은 `ctx`로 본인만**(admin은 전체), TEAM_EVENT은 전원. 권한 차단은 조회 단계에서 — 마스킹은 시각·신원을 못 가린다(§9).

`RawEvent`는 마스킹/ dedup 이전의 원본 필드를 보존한다(마스킹은 feed 합성 단계에서 적용).

## 7. feed 합성 흐름

`GET /api/calendar/feed?view=work|leave|personal&start[&teamId]`

`start`는 **앵커**(보려는 달의 임의 시각)다. 서버는 이를 포함하는 **정규화된 6주 그리드 창**을 계산해 응답한다. 임의 `(start,end)` 범위는 Phase 3 계약에서 제외한다 — 월 그리드 UI만 지원하며, 자유 범위는 §12.2 캐시 단편화를 되살리기 때문이다(필요 시 후속에서 별도 범위 API). 또한 앵커는 **운영 창(now 기준 ±`MAX_ANCHOR_MONTHS`=12개월)** 안이어야 하며, 밖이면 400 — 무제한 달 열거로 인한 외부 호출·캐시 행 증가를 막는다(§12.4, 적대적 리뷰).

1. 인증 + `requirePermission(userId, "calendar.{view}", "view")`.
2. view에 필요한 provider 집합을 `Promise.allSettled`로 **병렬 호출**(부분 실패 허용 — rejected는 해당 출처 failed로 환원).
3. **dedup**(§10): 내부 **APPROVED**(非tentative) 휴가와 겹치는 외부 휴가성 이벤트를 `DUPLICATE_OF_INTERNAL`로 마킹. PENDING(tentative) 휴가는 앵커가 아니다.
4. **tentative 필터**: 잠정(미승인) 일정은 본인·admin에게만. 타인에겐 마스킹이 아니라 `events`에서 **제외**(미승인 부재가 실제 부재로 보이지 않게).
5. **masking**(§9): 권한 없는 필드를 서버에서 제거/치환(응답에 민감정보 미포함).
6. `FeedResponse { events, sources, staleSources, failedSources }` 반환.

`SourceStatus.error`는 **클라이언트엔 일반 메시지로만** 내보내고(예: "일정을 불러오지 못했습니다"), 원본 예외는 **서버 로그**에만 남긴다(DB·외부 API 내부 정보 유출 방지 — 적대적 리뷰 #7). 상세 진단은 admin 뷰(후속)에서.

`teamId`는 team 뷰용 예약 파라미터(UI 후속). 엔진은 수용하되 Phase 3 UI는 사용하지 않는다.

## 8. view ↔ permission 매핑

| view 파라미터 | resource | permission key | Phase 3 UI |
| --- | --- | --- | --- |
| work | calendar.work | `calendar.work:view` | 노출 |
| leave | calendar.leave | `calendar.leave:view` | 노출 |
| personal | calendar.personal | `calendar.personal:view` | 노출 |
| team | calendar.team | `calendar.team:view` | API만(후속) |
| admin | calendar.admin | `calendar.admin:view` | API만(후속) |

API·UI가 **동일 permission key**를 공유한다(`useCan(...)` ↔ `requirePermission(...)`). 메뉴 숨김은 UX일 뿐, feed API도 같은 키를 검사한다.

### 8.1 외주 역할 권한 보정(Phase 3 포함)

현재 seed(`prisma/seed.ts` `ROLE_ALLOW`)는 `regular-developer`에만 `calendar.leave:view`를 부여하고 외주 역할(`contractor-developer`/`contractor-content`/`contractor-civil-response`)에는 없다. 그러나 §16대로 cutover 주 사용자가 외주 인력이고, 이들은 이미 `leave.request:view`/`leave.request:create`를 가진 **휴가 신청 당사자**다. 권한이 없으면 휴가 탭을 못 보거나 feed API가 403을 반환한다.

- **수정**: Phase 3는 세 외주 역할에 `calendar.leave:view`를 부여한다(seed `ROLE_ALLOW` 보정 — 스키마 변경 아님). 타인 휴가 상세는 §9 마스킹으로 가린다.
- **추가 방어**: UI는 서버 `getPermissionSummary` 기반으로 **권한 있는 탭만 노출**한다. 권한 부여(접근 가능)와 탭 노출(권한 없으면 숨김)을 함께 적용해, 권한 없는 사용자가 탭에서 403을 받는 경로를 없앤다.

## 9. 권한 마스킹 정책

- 마스킹은 **서버에서** 수행하고, 마스킹된 응답에는 민감정보를 싣지 않는다.
- 권한이 없으면 제목을 `휴가`/`부재`/`외부 일정` 요약으로 대체(`masked: true`), 휴가 사유·개인 일정 제목·외부 캘린더 설명은 `null`.
- 상세 열람은 PM/OWNER 및 명시 권한자만(매트릭스는 `calendar-design.md` §권한별 표시 정책 준수).
- 마스킹 매트릭스는 view + 대상 이벤트의 소유자/種별로 결정한다(본인 이벤트는 항상 상세, 타인은 권한에 따라).
- **마스킹은 안전망이 아니다(중요).** 마스킹은 title/description만 가리고 `userId`·시작/종료 시각은 응답에 남는다. 따라서 **노출 자체를 막아야 하는 데이터는 조회/합성 단계에서 차단**한다: ① 타인 PERSONAL_EVENT은 manual provider가 `ctx`로 애초에 조회하지 않고(§6), ② 타인 tentative(미승인) 일정은 feed가 `events`에서 제외하며(§7-4), ③ personal 뷰의 Google 소스는 provider가 본인 소유(`ownerUserId === ctx.userId`)만 **fetch**한다(§9·§12.3) — 타인 소스의 외부 호출·캐시 갱신·`sources[].key` 상태 누출을 fetch 이전에 차단. (적대적 리뷰 Finding 1·3, 후속 F2)
- **출처 식별자도 비밀 경계다(적대적 리뷰 5차).** `CalendarSource.externalId`(= Google calId, 개인 캘린더면 그 사람 이메일)는 **서버 전용**이며 `CalEvent`에 포함하지 않는다. 그러나 `sourceKey`·이벤트 `id`·`sources[].key`·`staleSources`·`failedSources`는 응답에 실려 UI에 노출되므로, 이들이 calId를 내장하면 **타이틀 마스킹과 무관하게 calId(이메일)가 누구에게나 유출**된다(성공 happy-path에서도). 따라서 **`CalendarSource.key`는 calId를 내장하지 않는 불투명 식별자**여야 한다 — 시드가 `googleSourceKey`로 생성하고, 실제 calId는 `externalId`에만 보관한다(§16/task-10). provider는 응답 필드(`id`/`sourceKey`/`status.key`)에 `key`만 쓰고 `externalId`는 fetch 대상으로만 사용한다(task-06 가드 테스트). **key 파생은 무염 해시가 아니라 HMAC(server secret `CALENDAR_SOURCE_KEY_SECRET`)** 으로 한다(후속 적대적 리뷰): calId가 이메일(저엔트로피)이면 무염 결정적 해시는 알려진 이메일 목록을 해싱해 `sources[].key`↔사람을 역매핑할 수 있다. HMAC은 secret을 모르면 재현 불가하되 같은 secret에선 결정적이라 재시드 upsert(`where: { key }`)가 멱등하다. secret 누락/약함(<16자)이면 시드는 fail-closed로 중단(약한 비밀로 key를 만들지 않음). secret 회전 시 기존 key가 바뀌므로 안정 유지(회전하면 기존 소스 행 재키잉 필요).
- **확장 지점(경계 부채)**: 현재 PERSONAL_EVENT 공개 정책은 "본인만 / admin 전체"가 기본이다. 추후 팀 멤버십·세부 권한 단위 공개(예: `calendar.personal.team:view`)는 provider가 받는 동일한 `ctx`(userId+permissionKeys)에서 분기하면 되며, **시그니처 변경 없이 비파괴로 확장**된다.
- **personal 뷰 = 본인 소유 + 공휴일만(Finding 2).** feed가 personal 뷰에서 `userId === 본인 || kind === HOLIDAY`이 아닌 이벤트를 **제외**한다(마스킹 아님 → 타인 userId·시각이 응답에 없음). 팀 휴가/일정 free/busy는 **work/leave 뷰에서만** 노출(거기선 의도된 기능 — 누가 언제 부재인지 공유). 이 게이트는 `VIEW_SOURCES.personal` 목록과 무관한 하드 게이트라 personal에 소스가 추가돼도 안전하다. `VIEW_SOURCES.personal`에서 `workflowTask`는 제외(사용자 귀속 없는 조직 일정). Google 이벤트가 personal에 나타나려면 owner-map으로 해당 소스 `ownerUserId`가 본인으로 채워져야 한다(§10) — Phase 3 기본(owner-map 비어 있음)에선 personal에 본인 휴가·본인 수동 일정·공휴일만 보인다.
- **personal 뷰 Google 소스는 fetch 단계부터 owner 스코프(후속 F2).** 위 event-filter는 *응답*만 거른다 — 그것만으로는 google provider가 personal 뷰에서도 **모든 활성 Google 소스를 fetch**해, 저권한(`calendar.personal:view`) 사용자가 타인 Google 캘린더의 외부 호출·캐시 갱신을 유발하고 `sources[].key`로 그 존재·상태를 알게 된다(트러스트 경계·쿼터 증폭). 따라서 google provider는 `view === "personal"`이면 `ownerUserId === ctx.userId` 소스만 `findSourcesByKind` 결과에서 추려 fetch한다(`createCalendarProviders({view})` → `createGoogleProvider({view})`). leave/admin 등 팀 뷰는 전체 소스(의도된 보조 데이터). holiday는 소유 개념이 없어 항상 전체.

## 10. 중복 제거(비파괴)

- 판정 기준: **`CalendarSource.ownerUserId`로 매핑된** Google 이벤트 ∩ 내부 APPROVED `LeaveRequest`(PENDING은 `tentative`로 앵커에서 제외 — Finding 3)와 **KST 날짜 겹침** + 휴가성 키워드(`휴가|연차|반차|오전반차|오후반차`) + **all-day**. **Phase 3는 all-day 외부 휴가만 dedup**한다 — "근무시간 대부분을 차지하는 timed 이벤트"는 임계 휴리스틱이 모호해 후속으로 미룬다. `ownerUserId`가 없는 공유 캘린더(예: 팀 공용) 이벤트는 사용자 attribution이 불가하므로 dedup하지 않고 `EXTERNAL_VACATION`으로만 표시한다.
- **`ownerUserId` 채우는 법 + Phase 3 기본(중요, Finding)**: 시드가 선택적 owner-map(`integrations.google.calendarOwners`: calId→이메일)으로 Google 소스에 `ownerUserId`를 설정한다(`prisma/seed-google.ts`의 순수 resolver, create·update 모두). **Phase 3 기본은 이 map이 비어 있어 모든 Google 소스가 `ownerUserId=null`(공유/팀)** → dedup-by-owner와 personal 뷰의 Google 노출은 **비활성**이다(team 캘린더는 work/leave 뷰에서 마스킹된 free/busy로만 보임). 개인별 Google 캘린더 dedup·personal 노출이 필요해지면 owner-map만 채워 **코드 변경 없이 데이터만으로 활성화**한다. 즉 ownerUserId 기계장치(provider 전파·dedup·personal 필터)는 완비돼 있고, 켜는 스위치는 owner-map 데이터다.
- 처리: 외부 이벤트를 **삭제하지 않는다.** `DUPLICATE_OF_INTERNAL`로 마킹하고 **응답 합성 단계에서만 접는다**(기본 뷰 미표시). 원본은 캐시에 남아 후속 admin 뷰에서 진단 가능.
- 사용자 매핑이 안 된 외부 휴가 → `EXTERNAL_VACATION`(상세 제한).
- 키워드 기반 휴리스틱이라 false positive 가능 → 비파괴 원칙이 안전판이다.

## 11. timezone / all-day 규약

- 서버 기준 timezone을 **`Asia/Seoul`로 고정**(내부 운영, 단일 locale).
- all-day 이벤트는 **`[start 00:00 KST, (end+1일) 00:00 KST)` 반열림 구간**으로 overlap을 계산한다.
- dedup 겹침 판정은 **KST 캘린더 날짜** 기준.
- `LeaveRequest`(DateTime), Google `date`(date-only), 공휴일을 모두 KST date로 정규화해 비교한다.
- 이 고정 덕에 캐시 키에 timezone/locale을 포함할 필요가 없다(상수).

## 12. 캐시 & 새로고침

### 12.1 캐시 대상

- 내부(leave/workflow): **캐시 안 함.** prisma 직접 조회 + 기존 인덱스(`LeaveRequest @@index([userId, startDate])`, `WorkflowTask @@index([typeId, scheduledAt])`).
- 외부(Google)·공휴일: `CalendarCacheEntry(sourceId, rangeStart, rangeEnd)` unique. TTL = `CalendarSource.cacheTtlSeconds`(Google 5~15분), 공휴일 24h.

### 12.2 캐시 키 / range 정규화

- **Google 캘린더 1개 = `CalendarSource` 1행**(`externalId = calendarId`, `kind = GOOGLE_CALENDAR`). 공휴일도 별도 `CalendarSource`(`kind = HOLIDAY`). → calendarId 차원이 `sourceId`(PK)에 내포된다.
- provider 호출 전 요청 range를 **캘린더 grid 기준 6주 창**(월 그리드 패딩 포함)으로 **고정 정규화**한다(provider마다 다르게 잡아 캐시가 다시 단편화되는 것을 차단; 월 그리드 UI 확정이므로 6주 창으로 단일화). 주 시작 요일은 UI 그리드 설정의 단일 출처를 따른다. 인접 월 prefetch와도 정합한다.
- 최종 캐시 키 = `(sourceId=per-calendar) + 정규화 range`.

### 12.3 만료 정책(표준 — 확정)

> Phase 3에서는 외부 소스에 대해 백그라운드 SWR을 구현하지 않는다. 캐시가 fresh이면 즉시 반환, expired이면 해당 요청에서 인라인 재검증한다. 재검증 실패 시 **last-good 캐시가 있으면** 그것을 반환하고 `staleSources`에, **last-good이 없으면(cold-cache 최초 실패)** 해당 소스를 빈 결과 + `failedSources`로 표시한다. 재검증 실패는 **warm/cold 모두 `expiresAt`을 짧은 backoff(min-refresh-interval)로 기록**해(warm은 last-good payload 보존), 장애가 지속돼도 만료 후 매 요청 재fetch하지 않는다(적대적 리뷰 Finding 2). 워커 기반 비차단 SWR은 스케줄러/디스패처 도입 Phase로 미룬다.

- 근거: Phase 1에서 outbox 워커/스케줄러를 의도적으로 스켈레톤으로 남겼다. 비차단 SWR을 억지로 만들면 범위가 폭증한다.
- **이벤트별 격리 정규화(후속 적대적 리뷰)**: Google 응답을 `raw.map(normalizeGoogleEvent)`로 한 번에 변환하면 start/end가 불완전한 한 건(취소·id-only 등)이 throw돼 **소스 전체 새로고침이 실패**한다 — 국소 불량 1건이 그 범위 전 이벤트를 stale/failed로 만든다. 따라서 `normalizeGoogleEvents`가 이벤트별 try로 불량 건만 건너뛰고 개수만 서버 로그로 남긴다(클라이언트엔 미노출). 회귀 테스트로 "불량 1건이 전체를 실패시키지 않음"을 고정한다.
- **동시성 가드(후속 F1)**: *같은 순간* 동시 요청이 만료 엔트리에 몰리는 thundering herd는, per-(source,range) **in-process in-flight 코얼레싱**으로 1회 재검증에 합류시켜 차단한다(`cache/index.ts`의 `inFlight` 맵). write가 fetch 프로미스 내부에 있어 'write 가시화'와 '맵 해제' 순서가 정렬돼, 합류 못 한 요청은 fresh 적중으로 early-return한다(빈틈 없음). **한계**: 프로세스 메모리라 단일 인스턴스에서만 유효(다중 인스턴스는 인스턴스당 1회로 bounded — 현 배포는 단일 인스턴스). §12.4 min-refresh-interval(기본 30초)은 *순차* 연타를, 이 가드는 *동시* 미스를 막는 상보 관계다. 만료 후 *장애 지속* 시 매 요청 재fetch(연타)는 위 backoff 기록으로 차단한다(적대적 리뷰 Finding 2).

### 12.4 수동 새로고침

`POST /api/calendar/refresh`

- `requirePermission(userId, "calendar.{view}", "view")` — 사용자가 이미 보는 데이터의 재검증이므로 view 권한 재사용. **별도 refresh 권한 키는 신설하지 않음(YAGNI).**
- **(view, start) → 정규화된 6주 창 범위로만** 캐시 무효화·재fetch. 전역 Google 캐시 강제 갱신(admin 성격)은 admin 뷰와 함께 후속.
- **cold·warm 실패 모두 backoff 마커로 기록**(짧은 만료 + errorMessage, warm은 last-good payload 보존)해, 직후의 *일반 요청*·*강제 새로고침* 모두 만료/min-interval 가드에 걸리게 한다. 안 그러면 만료 엔트리가 매 요청 재fetch되어 Google을 연타한다(적대적 리뷰 Finding 2; cold-cache는 기존 #6). cold 마커는 `payload=null`로 기록해 읽을 때 warm(stale)과 구분한다.
- **min-refresh-interval**: 최근 일정 시간(기본 30초, 상수로 정의) 내 재검증된 소스는 refresh를 무시해 Google 해머링/비용 폭주를 차단.
- **앵커 운영 창 제한(Finding)**: min-refresh-interval은 (source,range)별이라 *서로 다른 달*을 열거하면 매번 cold-fetch가 일어나(가드 우회) Google 호출·`CalendarCacheEntry` 행이 무한 증가한다. `start` 앵커를 now 기준 **±`MAX_ANCHOR_MONTHS`(12)** 로 제한해 키 공간(달×소스)과 외부 호출을 바운드한다 — GET·POST 라우트 공통 입력 검증. 사용자별 rate-limit은 소규모 내부 도구라 보류(YAGNI); 키 공간 제한이 1차 방어다.

## 13. UI(커스텀 경량)

- `/calendar`: 뷰 탭(업무·휴가·개인, §8.1대로 권한 있는 탭만) + **커스텀 월 그리드** + 월 이동(인접 월 prefetch) + 수동 새로고침 + 소스별 로딩/실패 배지 + **이전 데이터 유지**.
- 디자인 시스템(Tailwind v4 + 기존 ui 프리미티브 + 브랜드 팔레트) 기반. 제3자 캘린더 라이브러리 미사용.
- 종일 이벤트 칩 중심, `kind`별 브랜드 팔레트 색, 마스킹된 건은 요약 칩(`masked`), 잠정(미승인) 건은 점선/흐림 등 별도 스타일(`tentative` — 본인 휴가 신청 "진행중" 표시; 타인 것은 애초에 응답에 없음).
- 클라이언트는 마스킹된 feed 응답만 받는다.

### 13.1 React Query 도입(확정)

- **의존성 추가**: `@tanstack/react-query`(package.json).
- **Provider 배치**: `'use client'` `QueryProvider`(`QueryClientProvider`)를 `src/app/(app)/providers.tsx`로 만들고 `src/app/(app)/layout.tsx`(서버 컴포넌트)에서 children을 감싼다. QueryClient는 모듈 스코프가 아니라 Provider 안에서 생성(요청 간 캐시 누수 방지).
- **client boundary**: 캘린더 페이지/뷰 컴포넌트(`'use client'`)가 `useQuery`로 feed API 호출.
- **keepPreviousData**: React Query v5 API `placeholderData: keepPreviousData`로 월 이동 시 이전 월 데이터를 유지(빈 화면 깜빡임 방지).
- **prefetch**: 현재 월 표시 시 인접 월(±1)을 `queryClient.prefetchQuery`로 미리 가져온다(정규화된 6주 창 키 기준).
- **staleTime**: 외부 소스 캐시 TTL과 정합하게 설정(서버 캐시가 1차, 클라이언트 staleTime이 2차).
- SSR hydration(`HydrationBoundary`)은 초기 범위에서 도입하지 않는다(클라이언트 페칭으로 단순화). 필요성 검증 후 후속.

## 14. 테스트 전략(vitest, DB·외부 없이)

- provider 단위: 캐시 fresh / expired-재검증 / 실패-fallback(last-good 유 / cold-cache).
- range 정규화: 임의 range → 동일 정규화 창 매핑.
- dedup 판정: 키워드 + KST 날짜 겹침 + userId 매핑, false positive 비파괴 확인.
- **masking 매트릭스**: view × 사용자 역할 × 이벤트 소유자 조합.
- **권한·격리 negative 테스트(필수)**: ① 타인 PERSONAL_EVENT이 본인 personal feed에 **조회되지 않음**(manual provider가 본인 userId로만 질의 — 마스킹이 아니라 부재), ② warm 캐시 만료 + fetch 실패 직후의 재요청이 외부를 **재호출하지 않음**(backoff 유지), ③ 타인 PENDING(tentative) 휴가가 feed에서 **제외됨**(본인·admin만 노출). (적대적 리뷰 Finding 1·2·3)
- feed 합성: `Promise.allSettled` 부분 실패 → staleSources/failedSources 분기.
- Google 클라이언트는 **fake provider 주입**(googleapis 미호출).
- `lint`/`typecheck`/`build`/`test` 그린.

## 15. 경계 & 마이그레이션

- eslint boundaries: `calendar` 모듈은 kernel·lib·자기 모듈만 의존(§4.1). app은 모듈 경유, Prisma는 calendar repository에서만.
- settings 접근은 `@/kernel/settings/reader`만(boundaries no-restricted-imports 준수) — `integrations.google.calendarIds` 읽기.
- **스키마 변경 없음**. 인덱스 추가가 필요하면 prisma migration으로.

## 16. 배포 맥락(참고)

ops-hub의 cutover 대상은 현재 annual-leave가 서비스 중인 `http://172.21.10.27:3000/`(개발서버 kgs-dev). 이 IP:포트는 방화벽이 개방돼 **외주 인력이 재택근무로 접속하는 현재 유일한 경로**다(상세 SSOT: workspace-env `INVENTORY.md` §1.5). 즉 캘린더·연차의 실사용자가 원격 외주 인력이므로 **권한 마스킹과 원격 성능·캐시가 실사용 조건**이다. cutover 절차는 `docs/migration/initial-migration-plan.md` §7.

- **cutover 시 데모 시드 금지(Finding 1)**: 데모 `LeaveRequest`/`WorkflowTask`는 메인 `db:seed`에서 분리해 dev 전용 `prisma/seed-demo.ts`(`db:seed:demo`)로만 둔다. 메인 seed는 roles/permissions/CalendarSource/config만 부트스트랩 — production/cutover 재시드가 가짜 승인 휴가(캘린더 이벤트·dedup 앵커·연차 입력 오염)를 만들지 않게 한다.

## 17. 구현 순서(개요 — 구현 계획으로 분해)

1. 공통 타입 + calendar repository(권위 테이블·CalendarEvent·CacheEntry 조회/기록) + range 정규화·KST 유틸.
2. Google 클라이언트(lib): 인터페이스 + service account 실구현 + fake.
3. cache 레이어(read/write, TTL, 만료 정책, min-refresh-interval).
4. 출처 provider 5종(internalLeave·workflowTask·google·holiday·manual).
5. dedup + masking.
6. feed service + `GET /api/calendar/feed` + `POST /api/calendar/refresh`.
7. seed: CalendarSource(Google 캘린더별 + 공휴일) + **외주 역할 `calendar.leave:view` 부여**(§8.1). 샘플 LeaveRequest/WorkflowTask는 **dev 전용 `seed-demo.ts`로 분리**(메인 seed 제외 — Finding 1).
8. UI: `@tanstack/react-query` 도입 + `(app)` QueryProvider(§13.1), 커스텀 월 그리드 + 뷰 탭 3종(권한 있는 탭만) + 새로고침/상태 배지.
9. 테스트(§14) 전반 + boundaries 통과.

## 18. 미해결 / 후속

- team/admin **UI 뷰** 및 admin 진단(중복·실패·stale 소스).
- write-time projection(Phase 5 승인 → INTERNAL_LEAVE, Phase 4 WorkflowTask emit).
- 워커 기반 비차단 SWR(스케줄러/디스패처 Phase).
- Google write-back 필요성 검증.
- 전역 캐시 강제 갱신용 admin refresh 권한(필요 시 catalog에 action 추가).
