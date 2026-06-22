# 메뉴 관리 (Navigation CMS) — 증분 ③ (설계 spec)

> 작성일 2026-06-22 · 상태: 설계 확정(brainstorming 완료, 사용자 결정 반영) · 후속: `writing-plans-split` → 구현
> 계보: `user-management` 스펙(2026-06-21)이 예고한 **증분 ③ "메뉴 CMS(`NavigationItem` CRUD UI/API + `admin.navigation` 권한)"**. 역할↔권한 매트릭스 편집은 **증분 ②**로 별도 진행(본 스펙 제외).

## 1. 배경과 목적

`ops-hub`의 사이드바 메뉴는 코드 카탈로그(`src/kernel/access/catalog.ts`의 `NAV`)를 `prisma/seed.ts`가 매 배포 때 **upsert(=덮어쓰기)** 하는 구조다. 관리 UI가 없어 메뉴를 추가·수정·정렬하려면 코드 수정·배포가 필요하다. 또한 `NavigationItem` 스키마에는 `parentId`(self-ref 트리)·`sortOrder`·`requiredPermissionId`·`isActive`가 모두 있지만, 읽기 경로(`loadNavigation`)는 **최상위(`parentId: null`)·평면만** 처리해 **중메뉴(서브메뉴)가 화면에 나오지 않는다**.

본 스펙은 관리자가 화면에서 메뉴를 **추가·수정·삭제·정렬하고 메뉴별 필요권한을 지정**하며, **2단(대/중) 중메뉴를 사이드바 아코디언으로 노출**하는 기능을 정의한다.

이미 존재하는 기반(재사용 대상):

- 스키마: `NavigationItem`(`key`/`label`/`href?`/`parentId?`/`sortOrder`/`requiredPermissionId?`/`isActive`, self-ref `NavigationTree`), `Permission`, `RolePermission`, `AccessRole`, `AuditLog`
- 읽기: `src/kernel/navigation/index.ts`의 `loadNavigation(allowedKeys)` + `NavNode`, 렌더 `src/app/(app)/app-nav.tsx`(`AppNav`), 소비처 `src/app/(app)/layout.tsx`
- 권한 엔진: `src/kernel/access/index.ts`(`requirePermission`/`hasPermission`/`getPermissionSummary` — DB permission 직접 검사, nav와 독립), `decision.ts`(Deny우선·fail-closed), `catalog.ts`(`RESOURCES`/`ACTIONS`/`NAV`/역할 매트릭스)
- 시드: `prisma/seed.ts`(NavigationItem upsert + fail-closed 권한해석), 역할 매트릭스 기반 `RolePermission` delete+재삽입
- 트랜잭션·낙관적 락 패턴: `src/modules/leave/repositories/index.ts`(status-CAS, `updatedAt`)
- 모듈 패턴: `src/modules/admin/users/{services,repositories,validations}`

## 2. 범위

### 포함 (IN)

- `NavigationItem` CRUD UI/API: 추가·수정·삭제, 라벨·`href`·부모·필요권한·활성 편집
- **2단 트리**(대메뉴 + 중메뉴)와 형제 간 **순서(`sortOrder`) 변경**
- 메뉴별 **필요권한 1개 지정**(기존 권한 카탈로그에서 선택) 또는 **공개**
- 사이드바 **2단 아코디언 렌더**(`loadNavigation`/`AppNav` 확장)
- 메뉴 **SSOT를 DB로 전환**(seed=부트스트랩)
- 신규 권한 `admin.navigation`(`view`/`configure`)로 관리 화면 게이트
- 리뷰 보완: **역할 미리보기**(C2), **공개 라벨 명확화**(F3), **경로 검증**(F1), **cascade 삭제**(F2), **편집 반영·미리보기**(F4), **동시편집 낙관적 락**(F5)

### 제외 (OUT — 후속/별도)

- **역할↔권한(`RolePermission`) grant 편집기**(= user-management 증분 ②). 본 스펙은 메뉴가 어떤 권한을 *요구*하는지만 다루고, 그 권한을 누가 *가지는지*는 코드 시드/증분 ②가 담당
- **새 `Permission` 생성**(권한 카탈로그는 코드 진실원 유지 — D15)
- 3단 이상 트리, 메뉴 아이콘/뱃지, 외부 URL 메뉴, 권한 외 조건부 노출

## 3. 결정 기록 (Decisions)

> codex 적대검증은 아래 결정을 모른다. finding이 이 결정과 충돌하면 버그가 아니라 의도된 설계다 — 고치기 전 대조할 것.

| # | 결정 |
| --- | --- |
| **D1** | 본 스펙 = **메뉴 CMS(증분 ③)만**. 역할↔권한 매트릭스 편집(증분 ②)·새 `Permission` 생성은 제외. |
| **D2** | **컬럼 추가 없음 + FK 동작 마이그레이션(2개 FK, 1건).** `NavigationItem`의 기존 필드(`parentId`/`sortOrder`/`requiredPermissionId`/`isActive`)를 재사용(새 컬럼·모델 없음). 깊이 2단 제약은 앱 레벨 검증으로 강제. **단 fail-closed를 위해 두 FK를 `ON DELETE SET NULL` → `ON DELETE RESTRICT`로 바꾼다**: ① `requiredPermissionId`(권한 삭제 시 메뉴 공개 전락 방지 — D8/F-3), ② self-ref `parentId`(부모 삭제 시 자식 top-level 고아화 방지, cascade 레이스 봉합 — D11/F-4). Prisma relation에 `onDelete: Restrict` 명시, 마이그레이션 1건. |
| **D3** | **메뉴 SSOT = DB.** `seed.ts`의 `navigationItem`은 **create-if-absent**(`key` 없을 때만 생성, 있으면 라벨·순서·권한·활성 **건드리지 않음**). `catalog.ts`의 `NAV`는 "초기 부트스트랩 시드 데이터"로 의미 재정의(주석). **권한 카탈로그·역할 매트릭스는 코드 진실원 유지**(메뉴만 이관). fail-closed 권한해석은 create 경로에 유지(미해석 시 중단). |
| **D4** | **부모 노출 = 관용(컨테이너형).** 노드는 `(자체 권한 통과) OR (보이는 자식 ≥ 1)`이면 노출. "빈 부모 숨김"은 이 규칙에 포섭(보이는 자식 0 + 자체 권한 실패 → 숨김). 자식 권한이 부모 권한과 어긋나도 자식이 사라지지 않음. |
| **D5** | **부모 렌더:** `자체 권한 통과 && href != null`이면 **링크(이동+펼침)**, 그 외 노출되는 부모는 **그룹 토글(펼침만)**. 현재 경로가 자식 `href`면 부모 자동 펼침. |
| **D6** | **깊이 2단 강제.** 부모는 `parentId == null`인 노드만 가능(자식의 자식 금지). `parentId` 순환·자기참조 차단. 검증 위반 시 거부. **동시 reparent 레이스(F-7, DEFERRED_TO_IMPL):** 서로 다른 행의 두 reparent가 각자 스냅샷으론 통과해 depth-3·순환을 만들 수 있다(예: A→B 이동 + B→C 이동 = depth 3). 단일행 CAS로는 못 막음 → reparent는 **이동 노드+대상 부모(+관련 후손) 트랜잭션 락 후 재검증** 또는 **DB 레벨 depth/cycle 체크**로 막는다. 정확한 메커니즘+동시성 회귀테스트는 **impl plan AC로 연결**(§13). |
| **D7** | **`href` 검증(origin-relative만):** 정규식 **`^/(?!/)[A-Za-z0-9/_-]*$`** — 반드시 단일 `/`로 시작하되 **선두 `//` 금지**(protocol-relative 외부 링크 차단). `.`·`:`·`\`·`%`·공백은 문자클래스에 없어 자동 거부(스킴·인코딩 슬래시·백슬래시 차단). 즉 외부 origin·오픈리다이렉트로 새는 `href`는 **하드 거부**(§2 "외부 URL 메뉴 제외" 보장). 알려진 내부 라우트 대조는 **소프트 경고만**(저장 허용 — 페이지 선출시 등록 대비). 대조 출처는 **코드에 큐레이트한 라우트 prefix 상수**(`catalog.ts` 인근, 예: `/dashboard`·`/calendar`·`/workflows`·`/leave`·`/admin`). 유지 부담이 크면 형식 검증만으로 축소 가능(경고 생략). 그룹 헤더 부모는 `href` 없음 허용. **테스트(§11)**: 거부 `//host`·`//evilexample`·`http://x`·`/\x`·`/a b`, 통과 `/valid/path`·`/admin/navigation`. |
| **D8** | **`requiredPermission` = nullable(공개).** UI 기본값은 "권한 필수", 공개는 **명시적으로 선택**해야 하며 라벨은 **"공개 — 로그인한 모든 사용자"**. (오타가 메뉴를 공개로 흘리는 함정 방지.) **fail-open seam 봉합(F-3 — 이번 증분에서 FIX):** `NavigationItem.requiredPermissionId` FK가 `ON DELETE SET NULL`이면 Permission row 삭제 시 참조 메뉴가 **조용히 공개(null)로 전락**하는 auth fail-open이다. 안 적힌 불변식에 의존하지 않고 **DB가 강제**하도록, FK를 **`ON DELETE RESTRICT`로 마이그레이션**(D2)한다 → 참조하는 `NavigationItem`이 있는 한 Permission 삭제가 **거부**된다(fail-closed). 회귀테스트(§11)로 "참조된 권한 삭제 거부"를 고정. |
| **D9** | 관리 라우트 **`/admin/navigation`**. 읽기 게이트 `admin.navigation:view`, 모든 변경 `requirePermission(admin.navigation, "configure")`. |
| **D10** | **역할 미리보기:** 권한 선택 시 "이 권한을 ALLOW하는 역할" 실시간 표시. **역할 기준만**(개인 `UserPermissionOverride`·OWNER-항상허용 제외) — 추정치임을 명시. |
| **D11** | **삭제:** 자식 없는 노드는 확인 후 즉시 삭제. **자식 있는 부모**는 "이 메뉴와 하위 N개를 함께 삭제합니다" **확인 다이얼로그 → cascade 삭제**. cascade 트랜잭션은 ① 확인 시점에 잡은 **자식 ID 집합만** 삭제하고(`parentId`로 즉석 삭제하지 않음 → 미확인 자식 무단삭제 방지), ② 이어서 부모를 삭제한다. **`parentId` FK = `ON DELETE RESTRICT`(D2)이므로**, count 체크 이후 다른 관리자가 자식을 새로 만들거나 reparent해 부모가 여전히 참조되면 **부모 삭제가 DB에서 거부 → 트랜잭션 전체 롤백**(fail-closed, top-level 고아 0). UI엔 확인 자식 수 `N` 표기, 충돌 시 "다른 사용자가 하위 메뉴를 변경함, 새로고침" 안내. 비파괴 대안으로 **비활성(`isActive=false`) 토글**이 항상 별도 제공. **reparent-away 레이스(F-6, DEFERRED_TO_IMPL):** captured 자식이 확인~실행 사이 다른 부모로 옮겨가면 ID 삭제로 *옮겨간* 메뉴를 오삭제할 수 있다(parentId RESTRICT는 "여전히 이 부모 참조" 자식만 막음). → captured를 `(childId, parentId, updatedAt)`로 잡고 **각 자식을 `parentId`+`updatedAt` CAS로 삭제(영향 row 수 일치 요구)** 또는 부모+자식 행 락. 정확한 메커니즘+동시성 회귀테스트는 **impl plan AC로 연결**(§13). |
| **D12** | **동시편집:** 단일 편집은 `updatedAt` **낙관적 락**(`updateMany({where:{id, updatedAt}})` + `count===0` 충돌). 순서변경은 **트랜잭션** 일괄 재정렬 + 충돌 감지. **삭제(특히 cascade)는 부모 `updatedAt`만으로 불충분**(자식 추가는 부모 row를 안 건드림) → 앱 레벨 자식수 체크에 더해 **DB가 강제**: `parentId` FK `ON DELETE RESTRICT`(D2)로 늦게 들어온 자식이 부모 삭제를 거부·롤백시킨다(D11/F-4). |
| **D13** | **반영:** `loadNavigation`은 `(app)` 레이아웃(동적, 세션 의존)에서 매 요청 실행 → 변경은 **다음 페이지 이동에서 반영(재로그인 불필요)**. 변경 후 `router.refresh()`/`revalidatePath`로 즉시 갱신. 관리 화면에 **결과 사이드바 미리보기** 패널. |
| **D14** | **권한 카탈로그 보강:** `RESOURCES`에 `"admin.navigation"` 추가(→ `admin.navigation:view`), `EXTRA_PERMISSIONS`에 `["admin.navigation","configure"]`. **`admin` 역할 매트릭스**에 두 키 부여(OWNER 자동). 부트스트랩 `NAV`에 **`관리 > 메뉴 관리`** 자식 추가(닭-달걀 방지). |
| **D15** | **한계 명시:** 새 `Permission`이 필요한 새 보호영역 메뉴는 **개발자 동반**(권한은 코드 진실원). 관리 UI는 기존 권한 키 + 공개만 제시하며, 이 제약을 UI·문서에 명시. |
| **D16** | **모듈:** `src/modules/admin/navigation/{services,repositories,validations}`(`admin/users` 패턴 미러). zod 검증, 변경은 `AuditLog` 기록(기존 패턴 경량 적용). |
| **D17** | **`key` 생성 계약(F-5):** `NavigationItem.key`(unique)는 부트스트랩 보존·중복방지의 **정체성 키**. 관리자 생성 메뉴는 **서버에서 불변 opaque key 자동 생성**(cuid 등)하며 **사용자 입력·편집 불가**(가변 라벨에서 파생 금지 → 한글/중복 라벨 충돌·생성 실패 방지). 부트스트랩 메뉴는 기존 사람-읽기 key(`dashboard`/`calendar`/…) 유지. 라벨 수정은 key에 영향 없음. |

## 4. 데이터 모델 (D2 — 컬럼 추가 없음 + FK 동작 1건)

`NavigationItem`의 기존 필드를 그대로 사용한다(새 컬럼·모델 없음). 단 fail-closed를 위해 **두 FK를 `ON DELETE SET NULL` → `ON DELETE RESTRICT`로 바꾸는 마이그레이션 1건**을 포함한다 — `requiredPermissionId`(권한 삭제 시 메뉴 공개 전락 방지 — D8/F-3) + self-ref `parentId`(부모 삭제 시 자식 고아화·cascade 레이스 방지 — D11/F-4). Prisma relation에 각각 `onDelete: Restrict` 명시.

```
NavigationItem
  key                  String  @unique   // 안정 식별자(부트스트랩·중복방지)
  label                String              // 표시명
  href                 String?             // null = 그룹 헤더(이동 없음)
  parentId             String?             // null = 대메뉴, 값 = 중메뉴
  sortOrder            Int                 // 형제 내 표시 순서
  requiredPermissionId String?             // null = 공개(D8)
  isActive             Boolean             // false = 숨김(소프트)
  updatedAt            DateTime @updatedAt // 낙관적 락 키(D12)
```

앱 레벨 불변식(검증·서비스에서 강제):

- **깊이 2단(D6):** `parentId`가 가리키는 노드는 `parentId == null`이어야 한다. 자식을 다른 자식의 부모로 지정 불가. 자기참조·순환 불가.
- **공개 명시성(D8):** `requiredPermissionId == null`은 "공개"로 허용하되 UI에서 명시 선택만.
- **`href` 형식(D7):** 위 정규식. 그룹 헤더(중메뉴를 거느린 부모)는 `null` 허용.

## 5. SSOT·부트스트랩 (D3)

### 변경 전 → 후

- (현재) `seed.ts`가 `NAV`의 각 항목을 `upsert`하며 `update`에서 `label`/`href`/`sortOrder`/`requiredPermissionId`/`isActive`를 **덮어씀** → 관리자 편집이 배포 때 리셋.
- (변경) `navigationItem`을 **create-if-absent**로:
  - `key`로 조회 → **있으면 skip**(아무 필드도 갱신하지 않음).
  - **없으면 create** — 이때만 `catalog.NAV` 값 사용. fail-closed 권한해석 유지(권한 미해석이면 중단 — 공개 누출 방지).
- `catalog.ts`의 `NAV`는 주석으로 **"초기 부트스트랩 시드 데이터(이후 DB가 진실원)"**임을 명시.
- 권한 카탈로그(`RESOURCES`/`ACTIONS`/`EXTRA_PERMISSIONS`)와 역할 매트릭스(`RolePermission`)는 **기존대로 코드 진실원**(매 배포 재시드). 메뉴만 DB 이관.

### 트레이드오프(명시)

코드에서 `NAV`를 바꿔도 **기존 DB에는 반영되지 않는다(의도).** 부트스트랩 이후 메뉴는 화면에서 관리한다. 빈/신규 환경은 코드값으로 부팅, 운영 DB는 관리자 편집이 배포에 보존된다.

### 부트스트랩 시드 내용(D14)

기존 5개 대메뉴 유지 + `관리` 아래 자식 **`메뉴 관리`**(`href: /admin/navigation`, `requiredPermission: admin.navigation:view`) 추가. (관리 화면 자체가 사이드바로 도달 가능. 권한 없거나 메뉴 삭제 시에도 직접 URL로 복구 — 라우트는 권한 기반.)

## 6. 읽기 경로 (D4·D5)

### `loadNavigation` — 트리 + 관용 가시성

`NavNode`에 `children: NavNode[]` 추가. 활성(`isActive`)·트리 전체를 로드한 뒤 권한으로 필터한다.

```
ownAllowed(node)      = node.requiredPermissionId == null            // 공개(D8)
                        || allowedKeys.has(permissionKey(node))
visibleChildren(node) = node.children
                          .filter(isActive)
                          .filter(c => ownAllowed(c))                 // 자식은 leaf(2단)
                          .sort(sortOrder)
visible(parent)       = ownAllowed(parent) || visibleChildren.length > 0   // D4 관용
```

- 보이는 부모만 정렬(`sortOrder`)해 반환. 각 부모는 `visibleChildren`를 포함.
- 부모 자체 권한이 실패해도 보이는 자식이 있으면 부모 노출(컨테이너) — 자식 증발 방지.
- `isActive=false`는 부모·자식 모두 제외.

### `AppNav` — 2단 아코디언 (D5)

- 부모 렌더: `ownAllowed(parent) && parent.href != null` → **`<Link>`(이동+펼침)**, 그 외 보이는 부모 → **토글 버튼(펼침/접힘만)**.
- 자식 있는 부모는 펼침/접힘. 현재 경로가 자식 `href`(또는 그 하위)면 **자동 펼침**.
- 접근성: 토글에 `aria-expanded`/`aria-controls`, 키보드 조작, `prefers-reduced-motion` 존중.
- 펼침 상태 기억(localStorage)은 선택(자동 펼침으로 기본 동작 충분 — YAGNI, 미포함).

## 7. 관리 UI — `/admin/navigation` (D9~D13)

서버 컴포넌트(게이트 `admin.navigation:view`) + 클라이언트 에디터.

- **트리 표시**: 대메뉴 → 중메뉴 들여쓰기. 각 행: 라벨, `href`(또는 "그룹"), 필요권한 칩(또는 "공개"), 활성 토글.
- **순서 변경**: 형제 간 드래그(또는 ↑/↓). 저장 시 형제 묶음 `sortOrder` 트랜잭션 재정렬(D12).
- **추가/수정 모달**: `label`(필수), `href`(D7 검증·소프트 경고), **부모 select**(대메뉴 목록, 2단 제약), **필요권한 select**(권한 카탈로그 + "공개 — 로그인한 모든 사용자"(D8)), 활성. **`key`는 입력 항목이 아님** — 서버가 생성 시 불변 opaque key 자동 부여(D17).
  - 권한 select 옆 **역할 미리보기**(D10): "이 권한이 보이는 역할: PM·관리자·정규개발"(역할 기준 추정).
- **삭제**(D11): 자식 없으면 즉시. 자식 있으면 "하위 N개 함께 삭제" 확인(cascade) 또는 비활성 안내.
- **미리보기 패널**(D13): 현재 편집 상태 기준 결과 사이드바 미리보기.
- **한계 안내**(D15): "새 보호영역(새 권한)이 필요하면 개발자에게 요청" 안내 문구.

## 8. 쓰기 경로 — 서비스·검증 (D12·D16)

모듈 `src/modules/admin/navigation/`:

- `validations/`(zod): `label`(필수), `href`(D7), `parentId`(2단·순환 — D6), `requiredPermissionId`(카탈로그 존재 또는 null), `sortOrder`. **`key`는 클라이언트 입력 아님 — create 시 서버 생성·유니크 보장, edit에서 불변(D17).**
- `services/`: 모든 변경 진입에서 `requirePermission(userId, "admin.navigation", "configure")`. 생성/수정/삭제/재정렬. 수정·삭제는 `updatedAt` 낙관적 락(D12), 재정렬은 트랜잭션. 변경 후 `AuditLog` 기록.
- `repositories/`: Prisma 접근. 트리 조회(부모+children), 형제 재정렬, CAS 업데이트.
- API/Server Action: 관리 화면이 호출. 응답 후 `router.refresh()`로 사이드바 갱신(D13).

### 역할 미리보기 쿼리(D10)

`rolesGrantingPermission(permissionId)`: `RolePermission`에서 `effect=ALLOW`인 역할들을 조회해 `{key,name}[]` 반환. 개인 override·OWNER-항상허용은 제외(추정치임을 UI에 명시).

## 9. 권한 카탈로그 변경 (D14)

- `RESOURCES`에 `"admin.navigation"` 추가 → `admin.navigation:view` 자동 생성.
- `EXTRA_PERMISSIONS`에 `["admin.navigation", "configure"]`.
- `admin` 역할 매트릭스에 `admin.navigation:view`·`admin.navigation:configure` 부여(OWNER는 전체 자동). 재시드 시 delete+재삽입으로 반영.
- 부트스트랩 `NAV`에 `관리 > 메뉴 관리` 자식(§5).

## 10. 엣지·실패 모드

- **부모 권한 < 자식 권한**(D4 관용): 자식이 내비에 남음. 부모 `href` 이동은 라우트 권한이 독립 보호 → 권한 없으면 redirect/403(메뉴 숨김=UX일 뿐, 접근제어 원칙).
- **메뉴 전부 삭제/락아웃**: `/admin/navigation` 직접 URL은 `admin.navigation` 권한만으로 열림(라우트 권한 기반) = 안전망.
- **깊이 위반·순환 `parentId`**(D6): 검증 거부.
- **외부/오픈리다이렉트 `href`**(D7, F-3 차단): `//host`·스킴·백슬래시·인코딩 슬래시는 하드 거부 → 신뢰 사이드바가 외부 origin으로 보내는 일 없음.
- **`href` 오타(죽은 내부 링크)**(D7): 소프트 경고 후 저장 가능. 죽은 링크는 관리 화면에서 식별 가능(경고 배지).
- **공개 오선택**(D8): 명시 선택 + 라벨로 의미 오해 방지.
- **권한 삭제로 인한 메뉴 공개 전락**(D8, F-3): 본 증분엔 권한 삭제 경로 없음 + 불변식으로 차단. 추후 권한관리는 fail-closed(참조 시 삭제 차단/FK RESTRICT) 필수.
- **동시 관리자 편집**(D12): 단일 편집 낙관적 락 충돌 시 "먼저 변경됨, 새로고침" 안내. **cascade 삭제**: parentId FK RESTRICT로 늦은 자식이 부모 삭제 거부·롤백(F-2/F-4); reparent-away 자식 오삭제 방지(자식별 CAS)·동시 reparent 트리 불변식은 **impl로 이전**(F-6/F-7 — §13).

## 11. 테스트

- `loadNavigation`: 트리 로드, 관용 가시성(부모<자식 권한 시 자식 유지), 빈 부모 숨김, `isActive` 제외, 정렬.
- `AppNav` 렌더: 부모 링크 vs 그룹 토글(D5), 자동 펼침.
- seed 부트스트랩: `key` 존재 시 skip(편집 보존), 미존재 시 create + 권한 fail-closed.
- 서비스 검증: 2단·순환 차단(D6), 권한 카탈로그 존재, 공개 허용(D8).
- **`key` 생성(D17)**: create 시 서버 생성 opaque key 유니크, **중복·한글 라벨에도 충돌/실패 없음**, edit 후 key 불변(보존).
- **`href` 검증(D7)**: 거부 `//host`·`//evilexample`·`http://x`·`/\x`·`/a b`(외부/오픈리다이렉트/형식위반), 통과 `/valid/path`·`/admin/navigation`. 알려진 라우트 외 = 소프트 경고(저장은 통과).
- 게이트: `admin.navigation` 없는 사용자 변경 차단(D9).
- **권한 FK fail-closed(D8/F-3)**: `NavigationItem`이 참조하는 `Permission` 삭제 시 `ON DELETE RESTRICT`로 **거부**됨(메뉴가 공개로 전락하지 않음). 미참조 권한 삭제는 허용.
- 낙관적 락(D12): 단일 편집 stale `updatedAt` 충돌.
- **cascade 삭제 동시성(D11/F-4)**: 정상 시 부모+captured 자식 삭제(고아 0). count 체크 **이후** 자식 insert/reparent 발생 시 `parentId` FK RESTRICT로 **부모 삭제 거부 → 롤백**(무단 삭제·top-level 고아 0). captured ID만 삭제됨을 검증.
- 역할 미리보기(D10): ALLOW 역할만 반환, override/OWNER 제외.
- 회귀: 기존 `loadNavigation` 소비처(layout)·권한 엔진 영향 없음.

## 12. 영향·마이그레이션

- 코드 변경: `kernel/navigation`(트리·관용), `app-nav.tsx`(아코디언), `kernel/access/catalog.ts`(권한·NAV), `prisma/seed.ts`(create-if-absent), 신규 `modules/admin/navigation/*`, 신규 `app/(app)/admin/navigation/*`.
- **DB 마이그레이션 1건(2개 FK 동작 변경)**(D2/D8/D11): `NavigationItem`의 `requiredPermissionId`·self-ref `parentId` FK를 각각 `ON DELETE SET NULL → RESTRICT`(컬럼 변경 없음, 제약 동작만). 권한 카탈로그 변경은 `db:seed`로 반영(새 permission 등록 + admin 역할 grant).
- 운영 dev 배포 시: `db:seed`가 `admin.navigation` 권한·역할 grant 등록 + (메뉴는 부트스트랩이라 기존 메뉴 보존, `메뉴 관리` 자식만 신규 create).
- 다른 작업과의 경계: 사이드바 2단 전환은 일부 영역이 쓰던 "화면 안 탭" 패턴과 무관(탭은 페이지 내 하위 네비게이션, 본 스펙은 사이드바 메뉴). 탭→사이드바 이관은 본 스펙 제외.

## 13. 적대검증 ledger (codex, base=main)

spec 단계 review-loop 결과. blocking score 추세: **7 → 3 → 4 → 6**(cascade 동시성 family 3회 반복 + reparent 신규 → 판정 루프 전환).

| # | finding | sev | disposition | 처리/연결 |
| --- | --- | --- | --- | --- |
| F-1 | `href` 정규식이 protocol-relative 외부링크 허용 | high | **FIXED** | D7 정규식 `^/(?!/)…` + §11 테스트. 라운드2 소멸 확인 |
| F-2 | cascade 삭제가 확인 후 추가/이동 자식 삭제·고아화 | high | **FIXED→재정의** | D11 captured-ID + parentId FK RESTRICT(F-4로 발전) |
| F-3 | 권한 FK `ON DELETE SET NULL`+null=공개 ⇒ fail-open | high | **FIXED** | D8/D2 `requiredPermissionId` FK→RESTRICT + §11 회귀. 라운드3 소멸 확인 |
| F-4 | cascade 잔존 레이스(count 체크 후 insert/reparent) | high | **FIXED** | self-ref `parentId` FK→RESTRICT(D2/D11/D12). 라운드4 소멸 확인 |
| F-5 | create 플로우의 `key` 미정의 | med | **FIXED** | D17 서버 생성 불변 opaque key + §11 테스트. 라운드4 소멸 확인 |
| F-6 | cascade가 **reparent-away된** 자식을 ID로 오삭제 | high | **DEFERRED_TO_IMPL** | 자식별 `(parentId, updatedAt)` CAS(영향 row 수 일치) 또는 행 락 → **impl plan AC + 동시성 회귀테스트**(D11) |
| F-7 | 동시 reparent가 depth-2·비순환 불변식 위반 | high | **DEFERRED_TO_IMPL** | reparent 트랜잭션 락+재검증 또는 DB depth/cycle 체크 → **impl plan AC + 동시성 회귀테스트**(D6) |

**미판정 blocking: 0** — F-1~F-5 FIXED(라운드2~4에서 소멸 확인), F-6·F-7 DEFERRED_TO_IMPL(아래 impl 인수기준으로 연결). low: 없음.

### impl plan으로 가져갈 인수기준(AC) — DEFERRED high
1. **cascade 삭제 동시성(F-6):** 확인 시 `(childId, parentId, updatedAt)` 캡처 → 트랜잭션 내 각 자식 `parentId`+`updatedAt` CAS 삭제, 영향 row 수 == 캡처 수 아니면 롤백+새로고침. **테스트:** 확인 후 자식 reparent-away → 그 자식은 삭제되지 않고 작업 롤백.
2. **reparent 트리 불변식(F-7):** reparent는 이동 노드+대상 부모(+후손) 락 후 depth/cycle 재검증, 또는 DB 레벨 enforcement. **테스트:** 두 유효 단일 reparent(A→B, B→C / A→B, B→A)가 동시 적용돼도 depth-3·순환이 생기지 않음(하나는 거부).
