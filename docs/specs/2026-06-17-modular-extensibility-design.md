# 확장·분리 가능한 모듈 경계와 신원 연동 전략

- 상태: Draft (검토 대기)
- 작성일: 2026-06-17
- 관련 문서: [ADR-0001](../../adr/0001-new-repo-postgresql-modular-monolith.md), [ADR-0002](../../adr/0002-access-control-model.md), [calendar-design](../../architecture/calendar-design.md), [knowledge-graph-studio-boundary](../../discovery/knowledge-graph-studio-boundary.md)

## 1. 배경과 목적

`ops-hub`는 `day-sync`(업무 자동화)와 `annual-leave`(연차 관리)를 재설계해 통합하는 내부 업무 운영 허브다. 두 POC는 "바이브 코딩/AI 에이전트 학습" 과정에서 시작했지만 이미 실제 업무에 쓰이고 있고, 앞으로 다음을 수용해야 한다.

- **같은 스택 확장**: leave/workflows 같은 새 업무 도메인, 그리고 AX 전환 프로젝트의 대시보드 같은 내부 화면을 모듈로 추가.
- **이종 스택 연계**: `knowledge-graph-studio`(KGS, Python) 같은 별도 런타임 서비스를 흡수하지 않고 **최소 SSO**, 가능하면 포털/상태까지 엮음.

운영 현실은 **소규모·온프렘·Tailscale**이다. 따라서 이 전략의 목적은 "지금 마이크로서비스를 만드는 것"이 아니라, **과설계 없이 경계를 깔끔하게 만들어 나중에 어떤 프로젝트가 와도 쉽게 붙고, 필요하면 싸게 떼어낼 수 있는 뼈대를 세우는 것**이다.

> 핵심 원칙 한 줄: **"경계는 분산 시스템처럼 엄격하게, 배포는 모놀리스로 단순하게."**

## 2. 목표와 비목표

### 목표

- 같은 스택 도메인(workflows·leave·calendar·미래 대시보드)을 **한 모듈만 추가하면 붙는** 구조로 만든다.
- 이종 서비스(KGS 등)를 **최소 SSO + 포털**로 엮되, ops-hub에 흡수하지 않는다.
- 어떤 모듈이든 나중에 별도 서비스로 **추출하는 비용을 낮게** 유지한다.
- 인증·사용자 계정은 **단일 출처로 공유**하고, 권한은 같은 스택이면 그대로 공유, 외부 앱이면 coarse 정보만 공유한다.

### 비목표 (지금 만들지 않는 것 — 과설계 방지선)

- 런타임 마이크로서비스 분할(서비스 메시, DB-per-service 배포). ❌
- 풀 OIDC 제공자(Hub-as-IdP)나 전용 IdP 운영. ❌ — B 전환 *경로*만 확보한다.
- 메시지 큐 인프라(Kafka/RabbitMQ). ❌ — 인-프로세스 이벤트 + outbox로 시작한다.
- KGS의 RAG/그래프/모델 게이트웨이 흡수. ❌ — 경계 분석 결론을 유지한다.

## 3. 3계층 아키텍처

```text
┌─────────────────────────────────────────────────────────┐
│ Integration Surface (연동 표면)                          │
│   포털 카드 · health 상태 · forward-auth 게이트웨이       │
│   └→ KGS, AX 대시보드, 미래 외부 앱  (이종 스택 OK)       │
├─────────────────────────────────────────────────────────┤
│ Domain Modules (도메인 모듈) — 같은 스택, 플러그형        │
│   workflows │ leave │ calendar │ (future: ax-dashboard…) │
│   각자 공개 인터페이스만 노출, 서로 직접 참조 금지        │
├─────────────────────────────────────────────────────────┤
│ Shared Kernel (공유 커널) — 모두가 의존하는 단 하나의 층  │
│   identity · user · RBAC/permission · audit · settings   │
│   · navigation · event-bus(outbox/dispatcher)            │
└─────────────────────────────────────────────────────────┘
        의존 방향: 위 → 아래 만 허용 (역방향·횡방향 금지)
```

- **커널은 모듈을 모른다.** 모듈은 커널에만 의존한다. 모듈끼리는 직접 호출 대신 **이벤트**로만 느슨하게 연결한다.
- **calendar는 "소비자/투영(projection) 모듈"** 로 재정의한다. workflows·leave가 발행한 이벤트를 듣고 캘린더 이벤트를 만들 뿐, 그들의 테이블을 직접 참조하지 않는다.
- **Integration Surface는 인증 어댑터 뒤에 숨긴다.** forward-auth(A) 구현이 한 곳에 모여, 나중에 전용 IdP(B)로 바꿔도 모듈/커널은 바뀌지 않는다.

## 4. 무엇을 어떻게 공유하나 (인증·계정·권한)

| 대상 | 인증(로그인) | 사용자 계정 | 권한 |
| --- | --- | --- | --- |
| **같은 스택 모듈**<br>(workflows·leave·calendar·미래 대시보드) | 완전 공유 (같은 세션) | 같은 `User` 테이블 직접 사용 | ops-hub RBAC **그대로** 공유 (`requirePermission` 동일 호출) |
| **외부 서비스**<br>(KGS·외부 대시보드) | 공유 (한 번 로그인 → SSO) | **단일 출처 = ops-hub**, 외부 앱은 별도 계정 DB 없음 | coarse 역할/그룹만 **클레임으로** 전달, 세밀한 앱 내부 권한은 앱이 자체 매핑 |

핵심 3가지:

1. **사용자 계정의 단일 출처(SSOT)는 ops-hub**다. 어떤 앱도 따로 회원 DB를 두지 않는다.
2. **인증은 모두 공유** — 한 번 로그인하면 ops-hub 모듈도 KGS도 다시 로그인하지 않는다.
3. **권한은 "공유하되 깊이는 다르게"** — 같은 스택은 정교한 RBAC를 그대로, 외부 앱은 coarse 그룹만 넘기고 세부는 위임한다. ops-hub의 `resource:action` 테이블 전체를 외부(Python) 앱에 이식하지 않는 것이 느슨한 결합의 핵심이다.

## 5. 모듈 경계 계약 (separability의 본체)

목적: **"같은 DB·같은 프로세스에 있어도, 코드는 떨어진 서비스인 것처럼 행동하게 만든다."**

### (1) 모듈은 공개 인터페이스만 노출

```text
modules/leave/
  index.ts          ← 공개: 서비스 함수 + 타입만 export (유일한 출입구)
  services/         ← 내부 (외부 import 금지)
  repositories/     ← 내부
  events.ts         ← 이 모듈이 발행/구독하는 이벤트 정의
```

다른 모듈은 `import { getTeamAbsence } from '@/modules/leave'`만 가능하다. 내부 repository나 Prisma 모델 직접 접근은 금지한다.

### (2) 경계를 CI에서 기계로 강제

`eslint-plugin-boundaries`로 못 박는다.

```text
요소 분류:  kernel · module · lib · app
허용 규칙:
  module  →  kernel, lib        (커널과 공용 유틸만 의존 가능)
  module  →  다른 module        ❌ 금지 (lint 에러로 CI 실패)
  kernel  →  module             ❌ 금지 (커널은 모듈을 몰라야 함)
```

경계가 "문서"가 아니라 "테스트"가 되어, 위반 시 빌드가 실패한다.

### (3) 모듈 간 통신 = 이벤트 (+ outbox 패턴)

모듈끼리 직접 호출하지 않고 이벤트로 협업한다.

```text
[leave]  연차 승인 처리
   │  같은 트랜잭션 안에서:
   │   ① leaveRequest.status = APPROVED 저장
   │   ② outbox 테이블에 "leave.approved" 이벤트 저장   ← 핵심
   ▼
[dispatcher]  outbox를 읽어 구독자에게 전달
   ▼
[calendar]  "leave.approved" 듣고 → CalendarEvent(INTERNAL_LEAVE) 생성
```

**outbox에 같은 트랜잭션으로 저장하는 이유**: "DB 저장"과 "이벤트 발행"이 분리되면 저장 직후 프로세스가 죽었을 때 이벤트가 증발한다. 둘을 한 트랜잭션으로 묶으면 "원본은 바뀌었는데 이벤트는 안 나간" 상태가 원천 불가능하다. 분리 시 outbox를 메시지 큐가 읽게만 바꾸면 된다.

### (4) DB 소유권 표시 (선택)

Postgres schema-per-module(`kernel`, `workflows`, `leave`...)로 소유를 물리적으로 표시한다(Prisma `multiSchema`). 부담되면 테이블 접두사로 시작해도 된다. 추출 시 "이 스키마만 들고 나간다"가 명확해지는 효과가 목적이다.

## 6. 데이터 정합성 보장 (수용 기준)

FK를 제거해 느슨하게 결합하더라도 **원본의 생성·변경·삭제가 항상 투영(consumer)에 반영**되어야 한다. 이를 두 겹으로 보장한다.

1. **생명주기 이벤트 + outbox (놓침 없음)** — 원본 모듈은 `created / updated / deleted` 세 가지를 모두 발행한다. 소비자는 셋 다 처리하며(삭제 이벤트 → 투영 삭제), 핸들러는 **멱등(idempotent)** 으로 만들어 같은 이벤트를 두 번 받아도 안전하게 한다.
2. **주기적 정합성 재조정(reconciler) — 자가 치유** — FK가 없으므로 만에 하나 이벤트가 누락돼도 드리프트가 남지 않게, 주기 작업이 "원본 ↔ 투영"을 대조해 어긋난 것을 바로잡는다. (`annual-leave`의 `usedDays recalculate` 작업과 같은 철학)

> **수용 기준**: *원본의 생성·변경·삭제는 항상 투영에 반영되며, 재조정 작업으로 검증 가능하다.*

## 7. schema.prisma 변경

마이그레이션이 아직 없어 변경 비용이 가장 낮은 시점이다.

### (1) CalendarEvent를 소프트 참조로

**현재** — calendar가 workflows·leave에 하드 FK로 물려 있다.

```prisma
model CalendarEvent {
  workflowTaskId String?
  workflowTask   WorkflowTask? @relation(fields: [workflowTaskId], references: [id])
  leaveRequestId String?
  leaveRequest   LeaveRequest? @relation(fields: [leaveRequestId], references: [id])
  @@index([workflowTaskId])
  @@index([leaveRequestId])
}
```

**제안** — 소프트 참조로 교체하여 calendar가 원본 테이블 없이도 독립한다.

```prisma
model CalendarEvent {
  sourceModule String?   // "workflows" | "leave" | "google" | "holiday"
  sourceId     String?   // 원본 식별자 — FK 아님, 문자열
  @@index([sourceModule, sourceId])
}
```

- 잃는 것: DB 차원 참조 무결성(원본 삭제 시 자동 cascade).
- 보완: 생명주기는 이벤트가 책임지고(§6), 재조정 작업이 자가 치유한다.

### (2) 커널 역참조 정리

커널 `User`에서 모듈로의 역참조 컬렉션(`workflowTasks`, `leaveRequests`, `calendarEvents` 등)을 제거한다. 모듈은 `userId`로 커널을 가리키지만 커널은 모듈을 몰라야 한다.

- Prisma는 관계를 양쪽에 선언해야 하므로, 이를 *plain `userId` 컬럼 + 필요 시 raw FK*로 풀지, 일부 관계를 남길지는 구현 계획에서 확정한다. 원칙(**커널→모듈 의존 없음**)만 확정한다.

### (3) outbox 테이블 신설 (커널)

이벤트 전달 보장을 위한 `OutboxEvent` 테이블을 커널에 둔다(이벤트 종류, payload Json, 발행 시각, 처리 상태/시각).

## 8. 신원 연동부 (A안, B 전환 경로 내장)

목적: **"외부 앱과 엮이는 부분을 한 곳에 가둬서, A(forward-auth)에서 B(전용 IdP)로 바꿔도 그 한 곳만 고치게 한다."**

### 인증 어댑터

```ts
// lib/auth/federation/index.ts  ← 외부 연동은 전부 여기로
verifySession(req): Identity | null         // ops-hub 세션이 유효한가?
issueClaims(user): { sub, email, groups }   // 외부에 넘길 "최소 신원"
```

외부 앱은 어댑터의 **출력 형태**(`sub/email/groups`)만 본다.

### A안 동작 흐름

```text
① 사용자가 ops-hub에 로그인 → 세션 쿠키 (ops-hub-session)
② 대시보드 "KGS Workbench" 카드 클릭 → https://kgs.<tailnet>.ts/... (프록시 뒤)
③ 프록시가 KGS로 넘기기 전: auth_request → ops-hub GET /api/auth/verify (쿠키 동봉)
④ ops-hub 응답: 유효 → 200 + 헤더 X-Auth-Sub/Email/Groups / 무효 → 401
⑤ 200이면 프록시가:
     - 클라이언트가 보낸 X-Auth-* 헤더 전부 제거 (스푸핑 차단)
     - ops-hub가 준 검증된 헤더만 새로 붙임 → KGS로 전달
⑥ KGS는 X-Auth-Email/Groups를 읽어 자기 내부 권한으로 매핑
```

`groups`는 `systemRole`/`AccessRole`을 외부용 coarse 그룹으로 매핑한다(예: `["kgs-user","ops-admin"]`).

### 보안에서 반드시 지킬 2가지

1. **헤더 스푸핑 차단** — 프록시는 들어오는 `X-Auth-*`를 반드시 제거하고 ops-hub 검증값으로만 덮어쓴다. 안 그러면 사용자가 직접 `X-Auth-Groups: ops-admin`을 보내 관리자 행세를 할 수 있다.
2. **외부 앱 직접 노출 금지** — KGS는 프록시를 통해서만 닿아야 한다(Tailscale 망 + KGS의 loopback/nonlocal bind 정책 유지). 프록시 우회 시 인증이 무력화된다.

### B 전환 시

```text
A: 쿠키 + 프록시 subrequest + X-Auth-* 헤더
        ↓ (lib/auth/federation 어댑터 뒤만 교체)
B: OIDC — ops-hub(또는 전용 IdP)가 ID 토큰 발급, 외부 앱이 토큰 서명 검증
```

- 바뀜: 어댑터 구현, 프록시 설정, 외부 앱의 "신원 읽는 방식"(헤더→토큰).
- 안 바뀜: `issueClaims()` 출력 모양이 같으므로 외부 앱의 권한 매핑 로직도, ops-hub 모듈·RBAC·도메인 코드도 그대로다.

## 9. 모듈 추출 플레이북

경계 4종(인터페이스·lint·이벤트·스키마 소유)을 지켰다면 추출은 재작성이 아니라 기계적 이전이 된다.

| 이미 갖춘 경계 | 추출 시 할 일 |
| --- | --- |
| 모듈은 `index.ts` 인터페이스로만 호출됨 | 그 인터페이스 구현만 **HTTP 클라이언트로 교체** (시그니처 동일) |
| 모듈 테이블이 자기 스키마 | **그 스키마만** 새 DB로 이전 |
| 모듈 간은 outbox 이벤트 경유 | outbox를 **메시지 큐**에 연결 |
| 인증은 federation 어댑터 경유 | 추출 서비스도 forward-auth/OIDC 클라이언트로 (외부 앱과 동일 취급) |
| 커널에만 의존 | 커널을 공유 라이브러리로 두거나 추출 서비스가 커널 API 호출 |

## 10. 기존 ADR·문서와의 정합

이 전략은 기존 결정을 뒤엎지 않고 확장한다.

- **ADR-0001 (모듈형 모놀리스)** — 유효. "분리 가능성"을 일급 설계 동인으로 추가할 뿐 충돌 없음.
- **ADR-0002 (접근 제어)** — 유효. 외부 연동용 coarse groups 매핑 개념만 얹음.
- **calendar-design.md** — 이미 "출처별 합성·색인" 방향이라 소프트 참조와 정합. FK→소프트 참조 변경을 반영한다.
- **knowledge-graph-studio-boundary.md** — A안이 그 문서의 "1단계 링크/상태 → 2단계 reverse proxy → 3단계 SSO" 단계와 정확히 일치한다.

### 산출물

1. 신규 **ADR-0003 — 확장·분리 가능한 모듈 경계와 신원 연동 전략**
2. `schema.prisma` 변경 (CalendarEvent 소프트 참조 + 커널 역참조 정리 + outbox 테이블)
3. `CLAUDE.md`에 경계 규칙(모듈 간 import 금지, 이벤트 통신, 커널 의존 방향) 추가
4. 이 spec 문서

## 11. 수용 기준 (Acceptance Criteria)

- [ ] 커널/모듈/연동 표면 3계층이 디렉터리 구조와 의존 규칙으로 표현된다.
- [ ] `eslint-plugin-boundaries`가 모듈 간 직접 import와 커널→모듈 의존을 CI에서 차단한다.
- [ ] 모듈 간 통신은 outbox 이벤트로만 이루어지고 직접 호출/타 모듈 테이블 접근이 없다.
- [ ] 원본의 생성·변경·삭제가 항상 투영에 반영되며, 재조정 작업으로 정합성을 검증할 수 있다.
- [ ] `CalendarEvent`가 하드 FK 없이 소프트 참조로 동작하고 calendar 모듈이 독립적으로 빌드된다.
- [ ] 외부 앱이 ops-hub 세션으로 SSO 되고, 프록시가 클라이언트 `X-Auth-*` 헤더를 제거한다.
- [ ] 신원 연동 구현이 `lib/auth/federation` 한 곳에 격리되어 A→B 전환 시 모듈/커널 코드가 불변이다.

## 12. 남은 결정 (Open Questions)

- 커널 역참조 제거를 plain `userId` 컬럼으로 끝낼지, 일부 raw FK로 무결성을 보강할지.
- schema-per-module을 1단계부터 적용할지, 테이블 접두사로 시작했다가 도입할지.
- 리버스 프록시를 Caddy로 둘지 nginx로 둘지(Tailscale 연동·`auth_request` 설정 편의 기준).
- coarse `groups` 네이밍 규칙과 매핑 테이블 위치(SystemSetting vs 코드 상수).
- reconciler 실행 주기와 대상(초기엔 calendar 투영만 vs 연차 usedDays 포함).
