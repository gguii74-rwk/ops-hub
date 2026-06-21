# 사용자 관리 — ①계정 수명주기 + 관리자 사용자 관리 (설계 spec)

> 작성일 2026-06-21 · 브랜치 `feat/user-management` · 상태: 설계 확정(구현 전)

## 1. 배경과 목적

`ops-hub`는 접근제어 기반(스키마·권한 엔진)은 갖췄지만 **사용자를 만들고·승인하고·관리하는 화면과 플로우가 전혀 없다**. 로그인만 가능하고 회원가입·승인·관리자 사용자 추가·권한 부여 UI가 모두 비어 있다. 본 spec은 이를 채우는 **첫 번째 증분**을 정의한다.

이미 존재하는 기반(재사용 대상):

- 스키마: `User`(`status: UserStatus`, `employmentType`, `jobFunction`, `systemRole`, `department String?`), `AccessRole`, `Permission`, `RolePermission`, `UserAccessRole`, `UserPermissionOverride`, `NavigationItem`, `AuditLog`, `SystemSetting`
- 권한 엔진: `src/kernel/access/index.ts`(`hasPermission`/`requirePermission`/`getPermissionSummary`), `decision.ts`(`computeDecision`, Deny우선·fail-closed, ADR-0002), `catalog.ts`(`RESOURCES`/`ACTIONS`/`ACCESS_ROLE_KEYS`)
- 네비게이션: `src/kernel/navigation/index.ts`(`loadNavigation`, DB 기반 + `requiredPermissionId` 필터)
- 인증: `src/lib/auth/index.ts`(Credentials, `authorize`가 비-ACTIVE 차단), `config.ts`, `types.ts`(`SessionUser`), `src/middleware.ts`, `src/app/login/page.tsx`
- 메일 아웃박스: `MailDelivery`(workflows 스키마) + 연차에서 만든 drain 워커
- 트랜잭션 패턴: `src/modules/leave/repositories/index.ts`의 status-CAS(`updateMany({where:{id,status}})` + `count===0` 충돌)

## 2. 증분 범위

본 작업은 "사용자 관리 + 접근제어" 에픽의 **3증분 중 ①번**이다.

- **① (본 spec)** 계정 수명주기 + 관리자 사용자 관리
- ② 팀 모델 + 팀별 권한 (`Team`·소속·`scope=team` 활성화, 역할↔권한 매트릭스 편집, 개인 override는 ①에서 선행)
- ③ 메뉴 CMS (`NavigationItem` CRUD UI/API + `admin.navigation` 권한)

### 포함 (IN)

회원가입(자가 신청), 승인/거절, 관리자 직접추가, 사용자 목록·필터·편집, 역할 부여(`UserAccessRole`), **개인별 권한 예외(`UserPermissionOverride`) CRUD UI**, 비밀번호 자가변경 + 최초 로그인 강제변경, 승인·거절 결과 메일, 감사로그, 위임 가능한 `admin` 역할 신설, 권한 카탈로그 보강.

### 제외 (OUT — 후속 증분/별도)

`Team` 모델·팀별 권한(②), 역할↔권한 매트릭스 편집(②), 메뉴 CMS(③), 초대링크 가입 플로우(`INVITED`는 enum 예약만, 본 증분에서 미사용), OAuth/SSO, 비밀번호 외 사용자 자기 프로필 편집.

## 3. 결정 기록 (Decisions)

| # | 결정 |
| --- | --- |
| **D1** | 자가가입 진입 = **오픈 신청 + 관리자 승인**. 이메일 도메인 제한 없음(외주 외부 이메일 수용). 서버 자체가 망 제한 뒤라 남용 위험은 제한적. |
| **D2** | 신청서의 고용형태·직무·부서는 **희망값(참고, 비권위)**. 권한에 전혀 반영되지 않으며, 관리자가 승인 모달에서 고용형태·직무·역할을 **확정**한다. |
| **D3** | `UserStatus`에 **`PENDING`·`REJECTED` 추가** → `PENDING \| INVITED \| ACTIVE \| DISABLED \| REJECTED`. |
| **D4** | 관리자 직접추가 = **임시 비밀번호 → 즉시 `ACTIVE`** + `mustChangePassword=true`. 초대 토큰·수락 페이지 없음. |
| **D5** | 메일 알림 = **승인/거절 결과만 신청자에게**(아웃박스). 신규 신청 알림은 관리자 화면 **인앱 배지/목록**(메일 아님). |
| **D6** | ①증분 권한 부여 범위 = **역할 부여 + 개인별 override(B안)**. 역할↔권한 매트릭스 편집은 ②로 미룸. |
| **D7** | **비밀번호 자가변경 + 최초 로그인 강제변경**(`mustChangePassword` 플래그). |
| **D8** | 사용자관리 권한 = **위임 가능한 `admin` AccessRole 신설**(`admin.users:*` + `admin.settings` + `admin.audit:view`). `systemRole`을 OWNER/ADMIN으로 부여하는 것은 **OWNER만** 가능. |
| **D9** | 신청 데이터 모델링 = **A안: `User` 행 직접 생성**(`status=PENDING`). 희망값은 기존 `employmentType`/`jobFunction`/`department` 컬럼에 저장하고 `status`로 권위 여부를 구분. 새 컬럼은 `mustChangePassword`만. |
| **D10** | 중복 이메일 가입은 **거부(409, 중립 메시지)**. `REJECTED` 이메일의 자가 재신청도 차단하고, 관리자만 재활성한다. |
| **D11** | 승인/거절은 **status-CAS 트랜잭션**(`updateMany({where:{id,status:PENDING}})`, `count===0` → 409 충돌). 같은 트랜잭션에서 역할 부여·감사로그·메일 enqueue를 처리한다. |
| **D12** | **권한 상승 가드**: 비-OWNER는 OWNER/ADMIN `systemRole`을 부여할 수 없다(403). 마지막 OWNER의 강등/박탈을 막는다(최소 1 OWNER 보존). |
| **D13** | **권한 위임 anti-escalation(D12 확장)**. 위임 `admin`(비-OWNER)에 대해: (a) **자가 권한 mutation 금지** — 본인의 역할·override·`systemRole`·`status`를 스스로 변경할 수 없다(OWNER만). → "나에게 `pm` 부여" 차단. (b) **특권 역할 부여는 OWNER만** — `pm`·`admin` 등 시스템 역할 또는 `"*"`/`admin.*`를 포함한 역할의 부여·회수는 OWNER만. 위임 admin은 비특권 역할(개발/외주 4종)만 부여한다. (c) **보유 권한 한도 내 위임** — 위임 admin은 자신이 실제 보유한 권한에 한해서만 ALLOW override를 부여할 수 있다(가진 것 이상 못 줌). DENY override는 접근을 줄이므로 항상 허용. 모든 가드는 **라우트 permission 키 검사와 별개로 서비스 계층에서 강제**한다(권한키 분할 대신). |

## 4. 데이터 모델 / 마이그레이션

```prisma
enum UserStatus {
  PENDING    // 신규 — 자가 신청 후 승인 대기
  INVITED    // 예약(본 증분 미사용)
  ACTIVE
  DISABLED
  REJECTED   // 신규 — 거절된 신청(이력 보존, 자가 재신청 차단)
}

model User {
  // ... 기존 필드 유지
  // employmentType/jobFunction/department: PENDING이면 '희망값'(비권위), ACTIVE면 관리자 확정값
  mustChangePassword Boolean @default(false)  // 신규
}
```

마이그레이션 작업:

1. `UserStatus`에 `PENDING`, `REJECTED` 값 추가.
2. `User.mustChangePassword Boolean @default(false)` 추가.
3. **`admin` AccessRole 시드**(`key="admin"`, `isSystem=true`): `admin.users:{view,create,update,approve}` + `admin.settings:configure` + `admin.audit:view`.
4. **권한 카탈로그 보강**: `admin.users:create`(현재 누락), `admin.users:approve`를 시드에 추가(`admin.users:view`/`:update`는 이미 존재). `catalog.ts`의 `ACTIONS`에 `approve`는 이미 있음.

> A안 선택 근거: `User.employmentType`/`jobFunction`이 non-null 필수라 PENDING 신청도 어떤 값을 가져야 하는데, ① 로그인이 비-ACTIVE에서 차단되고 ② 승인 전까지 역할이 부여되지 않으므로 희망값이 권한 계산에 절대 반영되지 않는다. 따라서 별도 `requested*` 컬럼이나 분리 엔티티 없이 기존 컬럼 재사용이 안전하며 마이그레이션이 최소다. `status`가 권위 여부의 단일 구분자다.

## 5. 계정 수명주기 (상태 머신)

```
∅ ──self-signup──▶ PENDING ──approve(고용형태·직무·역할 확정)──▶ ACTIVE
                      └──reject──▶ REJECTED                       ▲   │
∅ ──admin-add(임시비번, mustChangePassword)──────────────────────┘   │
                                            ACTIVE ◀──enable── DISABLED
                                            ACTIVE ──disable──▶ DISABLED
                                            REJECTED ──(관리자 재활성)──▶ ACTIVE
```

전이 규칙:

- **자가 신청**: `∅ → PENDING`. 입력 = 이메일·이름·비밀번호 + 희망 고용형태·직무·부서. 비밀번호는 기존 정책(12자+) 재사용.
- **승인**: `PENDING → ACTIVE`. 관리자가 고용형태·직무·`AccessRole`을 확정. 결과 메일 발송.
- **거절**: `PENDING → REJECTED`. 결과 메일 발송.
- **직접추가**: `∅ → ACTIVE` (임시비번, `mustChangePassword=true`).
- **비활성/재활성**: `ACTIVE ↔ DISABLED`. `REJECTED → ACTIVE`는 관리자만(재활성).
- **로그인**(`authorize`): 비-ACTIVE는 기존대로 차단. ACTIVE이면서 `mustChangePassword=true`면 로그인은 되되 **강제로 비밀번호 변경 페이지로 리다이렉트**(세션 클레임 + 미들웨어/가드).
- **중복 이메일**(D10): `email` unique. 어떤 상태로든 존재하면 가입 거부(409, 중립 메시지). `REJECTED` 자가 재신청도 차단.

## 6. 권한 모델 변경

- **`admin` 역할**(D8): `admin.users:{view,create,update,approve}`, `admin.settings:configure`, `admin.audit:view`를 묶는다. PM(OWNER) 외에도 사용자관리를 위임할 수 있다. 기존 `pm` 역할은 `"*"`라 영향 없음.
- **권한 상승 가드**(D12): `systemRole`을 `OWNER`/`ADMIN`으로 설정·변경하는 요청은 행위자가 `OWNER`일 때만 허용(아니면 403). 마지막 `OWNER`를 강등/비활성하려는 시도는 거부.
- **위임 anti-escalation**(D13): `admin.users:update` 하나가 역할 부여·override·status·비번재설정을 모두 게이트하므로, **서비스 계층**에서 추가 가드를 강제한다 — ⓐ 비-OWNER의 자기 자신 역할/override/systemRole/status mutation 금지, ⓑ 특권 역할(`pm`/`admin`, `"*"`·`admin.*` 포함 역할) 부여·회수는 OWNER만, ⓒ ALLOW override는 행위자가 보유한 권한 범위 내에서만(DENY는 항상 허용). 위반 시 403. 이 가드들은 라우트 권한키 검사를 통과해도 별도로 적용된다.
- **UI↔API 키 일치**: 모든 관리자 라우트는 UI `useCan(...)`와 서버 `requirePermission(...)`가 동일 permission 키를 검사한다(메뉴 숨김은 UX, 실행 권한은 API에서). 개인 override는 엔진(`computeDecision`)이 이미 소비하므로 UI만 추가하면 즉시 반영된다(override DENY가 역할 ALLOW를 이김, OWNER만 예외).

## 7. 화면 (UI)

- **공개 가입** `src/app/signup/page.tsx`: `src/app/login/page.tsx` 미러. 이메일·이름·비밀번호 + 희망 고용형태·직무·부서. 제출 후 "승인 대기" 안내.
- **강제 비밀번호 변경** `src/app/(app)/account/password/`: `mustChangePassword` 사용자가 강제 진입. 일반 사용자의 자가 비번변경도 여기서.
- **사용자 목록** `src/app/(app)/admin/users/page.tsx` (서버 컴포넌트, `requirePermission(admin.users:view)`): 이름·이메일·상태·고용형태·직무·역할 컬럼, 상태/고용형태/직무/검색 필터, 페이지네이션, **승인 대기 배지**(PENDING 카운트 = 신규 신청 인앱 알림).
- **승인 모달**: PENDING 행에서 고용형태·직무·역할(체크리스트) 확정 → 승인. 거절 버튼 → REJECTED.
- **직접추가** `admin/users/new`: 이메일·이름·임시비번·고용형태·직무·부서·역할.
- **사용자 편집** `admin/users/[id]`: 속성 수정, `systemRole`(OWNER 가드), 상태 토글(disable/enable), 역할 체크리스트, **개인 override 패널**(섹션 8), 비번 재설정(임시비번 발급).

## 8. API 계약

전부 동일 permission 키로 게이트(fail-closed).

| 라우트 | 메서드 | 권한 | 비고 |
| --- | --- | --- | --- |
| `/api/auth/signup` | POST | 공개(미인증) | PENDING 생성, 중복 409 |
| `/api/auth/change-password` | POST | 인증(본인) | 변경 후 `mustChangePassword=false` |
| `/api/admin/users` | GET | `admin.users:view` | 목록·필터·페이지네이션 |
| `/api/admin/users` | POST | `admin.users:create` | 직접추가(임시비번·ACTIVE) |
| `/api/admin/users/[id]` | GET / PATCH | `:view` / `:update` | 속성·상태·systemRole 편집 |
| `/api/admin/users/[id]/approve` | POST | `admin.users:approve` | status-CAS, 역할확정, 메일 |
| `/api/admin/users/[id]/reject` | POST | `admin.users:approve` | status-CAS, 메일 |
| `/api/admin/users/[id]/roles` | POST | `:update` | `UserAccessRole` 부여/해제 |
| `/api/admin/users/[id]/overrides` | POST / DELETE | `:update` | `UserPermissionOverride` CRUD |
| `/api/admin/users/[id]/reset-password` | POST | `:update` | 임시비번 발급 + `mustChangePassword` |

`roles`·`overrides`·`[id]`(PATCH)·`reset-password` 라우트는 `admin.users:update` 키를 통과하더라도 **서비스 계층에서 D13 가드를 추가 적용**한다(자가 mutation 금지, 특권 역할 OWNER-only, ALLOW override 보유 한도). 위반 시 403.

### 개인 override 패널(섹션 7 편집 화면 내)

`UserPermissionOverride` CRUD. 입력 = 권한키 선택기(카탈로그 `resource:action`), `effect`(ALLOW/DENY), `scope`(own/team/assigned/all), `reason`, `startsAt`/`endsAt`. 사용자별 기존 override 목록(유효기간·만료 표시).

> `scope` 의미는 **기존 엔진(`computeDecision`)을 그대로 따른다**: ALLOW는 `scope="all"`만 전역 허용으로 인정되고 `own/team/assigned`는 권한 검사 시점의 target 컨텍스트에 따라 평가된다(DENY는 scope 무관 거부). 따라서 "이 사람에게 무조건 허용" 같은 단순 예외는 `scope="all"` ALLOW로 표현한다. `team`은 ②증분 전까지 target 컨텍스트가 없어 사실상 미작동임을 UI에서 인지시킨다.

## 9. 교차 관심사

- **감사로그**(`AuditLog`): create/approve/reject/edit/role변경/override/status변경/비번재설정 모두 `actorId`·`entityType="User"`·`action`·`metadata`로 기록. **트랜잭션 내** 기록.
- **메일**: 승인/거절 결과 메일을 `MailDelivery` 아웃박스에 enqueue(승인 트랜잭션 내), background drain(연차 워커 재사용). 발송 실패가 승인/거절 자체를 막지 않음.
- **트랜잭션·동시성**(D11): 승인/거절 = status-CAS(`updateMany where status=PENDING`, `count===0` → 409). 직접추가 중복 이메일 = `P2002` → 409. 역할 부여 idempotent(`UserAccessRole` unique `userId_roleId`, `createMany skipDuplicates`).
- **에러 처리**: zod 검증(400), 충돌(409), fail-closed 게이트(403). 비밀번호 정책은 기존 시드 정책(12자+) 재사용.
- **모듈 배치**: `src/modules/admin/users/{services,repositories,validations}/`. `Route Handler → Service → Repository → Prisma`.

## 10. 테스트 전략

`tests/`는 `src/` 레이아웃 미러. 서비스 + route-level:

- **signup**: PENDING 생성 / 중복이메일 409 / 희망값 저장되나 비권위(역할 없음·로그인 불가) 확인.
- **approve·reject**: PENDING→ACTIVE + 역할 + 메일 enqueue + 감사 / 더블승인 CAS 충돌(409) / reject→REJECTED + 메일.
- **admin-add**: ACTIVE + `mustChangePassword` / 중복 409.
- **password**: 자가변경 / 최초로그인 강제 리다이렉트 / 변경 후 플래그 해제.
- **override**: 생성·삭제 / 엔진 반영(override DENY가 역할 ALLOW를 이김).
- **게이트**: 각 라우트 `admin.users:*` 요구(미보유 403), `admin` 역할로 접근 가능, 비관리자 거부.
- **권한 상승 가드**: 비-OWNER가 OWNER/ADMIN 부여 불가(403), 마지막 OWNER 보존.
- **위임 anti-escalation(D13)**: 위임 admin이 ⓐ 자기 자신에게 `pm` 역할 부여 시도 → 거부(403), ⓑ 본인 역할/override/systemRole/status 자가 변경 → 거부, ⓒ `pm`/`admin` 특권 역할을 타인에게 부여 → OWNER만 허용·위임 admin은 거부, ⓓ 자신이 보유하지 않은 권한을 ALLOW override로 부여 → 거부(DENY override는 허용). 각각 테스트.
- **감사로그**: 각 mutation이 `AuditLog`에 기록되는지.

## 11. 미해결 / 후속

- 신규 신청 인앱 배지의 갱신 주기(폴링 vs 단순 페이지 진입 시 카운트) — 구현 시 단순 진입-시-카운트로 시작.
- 무한 PENDING 신청 방어(레이트리밋) — 망 제한으로 위험 낮음, 필요 시 후속.
- ②증분: `Team` 모델 + `scope=team` 활성화 + 역할↔권한 매트릭스 편집.
- ③증분: 메뉴 CMS(`NavigationItem` CRUD).
