# annual-leave 연차 데이터 마이그레이션 (2026-06-25, dev)

`docs/migration/initial-migration-plan.md` §4의 연차 데이터 부분을 실제 데이터로 구체화한 dev/테스트용 마이그레이션. 사용자 계정 이전(`2026-06-22-annual-leave-users.md`)의 후속 — 같은 16명의 **연차 할당·신청·이력**을 옮긴다.

## 출처 · 대상 · 범위

- **출처**: kgs-dev 운영 annual-leave SQLite `/opt/annual-leave/backend/prisma/database.sqlite` (읽기 전용). 테이블 `leave_allocations`·`leave_requests`·`leave_allocation_history`.
- **대상**: kgs-dev `:5433` PostgreSQL `opshub` (dev/테스트). **운영 cutover는 별도.**
- **범위**: 위 3개 테이블 전부. 단, **소유자(`userId`)가 opshub에 없거나 ggui74(OWNER, 본인)인 레코드는 제외**.
  - 사용자 계정은 이미 이전됨(16명, 새 cuid 발급). 연차 레코드의 `userId`는 소스 uuid라 **email을 다리로 opshub userId에 매핑**한다.
  - 소스 18명 중 적재 대상 소유자 = 16명(ggui74·hatecoding 제외). hatecoding은 opshub에 없어 자동 제외, ggui74는 본인 데이터 제외 결정.

## 스키마 매핑 (소스 SQLite → opshub PostgreSQL)

소스/타깃 모델이 거의 1:1이다(타깃이 소스를 기반으로 설계됨). 차이는 타입·enum뿐.

| 소스 테이블 | 타깃 모델 | 변환 |
| --- | --- | --- |
| `leave_allocations` | `LeaveAllocation` | `Float → Decimal(6,2)`. `usedDays`는 **재계산**(아래). |
| `leave_requests` | `LeaveRequest` | enum 1:1. soft-delete 필드(`deletedByAdminId`/`deletedAt`/`deleteReason`)는 소스에 없어 null. |
| `leave_allocation_history` | `LeaveAllocationHistory` | `createdBy → createdById`. |

enum 매핑(소스 String → 타깃 enum, 값 동일):

- `LeaveType`: `ANNUAL`/`HALF`/`QUARTER`
- `LeaveSubType`: `MORNING`/`AFTERNOON`
- `LeaveRequestStatus`: `PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`
- `AllocationChangeType`: 소스 `INITIAL`/`ADD`/`DEDUCT`/`CARRYOVER` ⊂ 타깃(+`ADJUSTMENT`)

## ID / FK 매핑 전략

- **행 id(uuid)는 보존** → 재실행 시 id 충돌로 skip(멱등) + `history.allocationId`(FK)가 자동으로 일치(remap 불필요).
- **사용자 참조 FK만 email로 remap**(user는 새 cuid로 이전됨):
  - 소유자 `userId`(allocation/request/history): opshub에 없거나 제외 대상이면 **레코드 skip**.
  - 검토자/관리자 참조(`reviewedBy→reviewedById`, `createdByAdminId`, `modifiedByAdminId`, `createdBy→createdById`): opshub에 있으면 매핑, 없으면 **null + 로그**(ggui74는 OWNER로 존재 → 검토자로는 정상 매핑).
- history는 자기 allocation이 제외되면 함께 skip(FK Cascade 대상이라 고아 방지).

## usedDays 재계산 (불변식 준수)

`LeaveAllocation.usedDays`는 ops-hub에서 캐시 필드(승인/취소 트랜잭션이 유지). 소스값을 맹복사하지 않고 **이전된 `APPROVED` 신청의 `days` 합을 시작연도 할당에 귀속**(spec D7: 교차연도도 시작연도 일괄)해 재계산한다.

- 시작연도 = `startDate`의 **KST 연도**(`+9h` 후 UTC 연도).
- 재계산값과 소스 `usedDays`가 다르면 **로그로 출력**(정합성 진단). dev DB는 앱 불변식과 일치하게 된다.
- 단, create-only(기본) 재실행 시 이미 존재하는 allocation은 skip되어 usedDays가 갱신되지 않는다 → 갱신하려면 `--reset`.

## 안전장치 · 멱등성

- `DATABASE_URL`에 `/opshub`가 없으면 즉시 중단(safety_report 등 오적재 방지). user 마이그레이션과 동일.
- 적재는 단일 트랜잭션. 기본은 **소스 id 기준 skip-duplicate**(재실행 안전).
- `--reset`: 적재 전 `leave.*`(History→Request→Allocation 순 삭제) 비우고 clean reload.
- `--dry-run`: DB 미변경, 매핑/제외/재계산 결과만 출력.

## 실행 절차 (서버)

```bash
# 1. 원본 export (root 소유 SQLite → kgs 소유 JSON. 민감정보 없음 — users는 id+email만)
sudo python3.11 scripts/migrate-al-leave-export.py > ~/al-leave.json
# 2. dry-run (DB 미변경, 매핑·제외·usedDays 재계산 결과)
cd /home/kgs/apps/ops-hub && npx tsx scripts/migrate-al-leave.ts ~/al-leave.json --dry-run
# 3. 적재 (재실행 안전 skip-duplicate). 깨끗이 다시 넣으려면 --reset
npx tsx scripts/migrate-al-leave.ts ~/al-leave.json
# 4. 정리
rm ~/al-leave.json
```

- `npx tsx`가 없으면 `npm run prisma:generate` 후 `node --import tsx ...` 또는 devDep 확인.
- 사용자 계정이 먼저 적재돼 있어야 한다(`2026-06-22-annual-leave-users.md` 완료 전제).

## 검증 항목

- 적재 allocation/request/history 건수 = (소스 − 제외) 와 일치(로그의 skip/제외 수로 역산).
- 사용자별 `(year)` `usedDays` = 해당 사용자 `APPROVED` 신청 `days` 합(시작연도 귀속).
- 임의 사용자 로그인 → `/leave` 본인 요약·신청 이력 표시, `/leave/calendar` 기간 막대 표시 확인.
- 관리자(`/admin/leave/approvals`) 승인 대기(PENDING) 목록 표시 확인.

## 실행 결과 (dev, 2026-06-25 적재 완료)

kgs-dev에서 SSH로 export→dry-run→적재→검증 완료(서버 git `6764722`, src·schema 무변경이라 재빌드 불필요).

- 적재: allocation **25** / request **120** / history **15**(소스 id=uuid 보존으로 식별). 제외: ggui74(OWNER) allocation 1.
- 신청 상태: APPROVED 99 · REJECTED 4 · CANCELLED 18 · **PENDING 0**(소스에 미결 신청 없음 → 승인 큐 테스트는 데모 데이터로).
- `usedDays` 재계산: 1건 보정(`source=2 → 2.25`).
- 참조 null 15(opshub에 없는 검토자/생성자).
- ⚠ DB 총계 26/121은 배포 `db:seed:demo`의 기존 데모 leave 1건씩 포함(이번 적재와 무관, 미변경).

## 운영 cutover 증분 전략 (이 스냅샷 이후 증분만 가져오기)

이 dev 마이그레이션은 소스의 **스냅샷**이다. 운영 cutover 때 스냅샷 이후 변경분만 가져올 수 있도록 워터마크·절차를 남긴다.

> **결정(2026-06-25)**: **현재 dev opshub DB(kgs-dev `:5433`)를 그대로 운영 DB로 사용**한다(새 운영 PostgreSQL 미생성). 따라서 cutover는 전체 재마이그레이션이 아니라 — ① 이 스냅샷 이후 **증분만 upsert** + ② dev 테스트 산출물 정리 + ③ 앱을 `:3000`으로 전환 — 이며, **증분 전략이 정식 경로**다.

### 워터마크 (이 마이그레이션이 포착한 경계)

- **스냅샷 시각**: 2026-06-25 16:26 KST(export 시점).
- **소스 최신 활동(실측)**: `leave_requests`·`leave_allocations` `max(updatedAt)` = **2026-06-17 10:46:27 KST**(epoch-ms `1781660787623`), `leave_allocation_history` `max(createdAt)` = 2025-12-31 14:00:22 KST. 스냅샷 8일 전부터 소스 변경 없음 → 스냅샷 완전.
- 소스 SQLite는 타임스탬프를 **epoch ms**로 저장. **머신 워터마크 `T = 1781660787623`**(이보다 큰 updatedAt/createdAt = 증분).

### 증분 추출 (cutover용 export 변형)

- `leave_requests`: `WHERE updatedAt > T` (신규 + 상태변경·관리자수정 포함)
- `leave_allocations`: `WHERE updatedAt > T`
- `leave_allocation_history`: `WHERE createdAt > T` (append-only)
- `usersIdEmail`는 매핑 다리라 **전량 export**(증분 아님). 신규 사용자가 생겼으면 사용자 증분(`migrate-al-users*`) 선행.

### 증분 적재 (load 변형)

- 현재 `migrate-al-leave.ts`는 **create-only(skip-duplicate)** — 증분엔 **upsert로 변경 필요**(스냅샷 이후 상태가 바뀐 기존 레코드가 skip되면 갱신 누락). 행 id(uuid) 보존이라 `prisma.upsert({ where:{ id } })` 키 일치.
- `usedDays`는 증분 적재 후 **영향 받은 `(userId, year)` 전체 재계산**(증분만 가산하면 취소·반려 반영 누락).

### 한계·주의 (cutover 설계 시 반드시 검토)

- **하드 삭제 미포착**: 타임스탬프 워터마크는 스냅샷 이후 소스에서 *물리삭제*된 행을 못 잡는다(연차 취소=상태변경이라 보통 무관하나, 물리삭제가 있으면 id 집합 대조 필요).
- ⚠️ **필수 선행 — dev 테스트 산출물 제거**: dev DB가 그대로 운영이 되므로(위 결정), cutover 전에 **dev 테스트로 생긴 데이터를 반드시 제거**해야 운영에 새지 않는다. 대상: `db:seed:demo` 데모 leave 데이터, **테스트로 만든 연차 신청(승인 큐 검증용 PENDING 등)**, 테스트 중 재계산/변경된 값. 소스에 없는 dev측 데이터라 증분과 무관하게 남으면 운영 오염. cutover 직전 `leave.*` 정리(또는 `migrate-al-leave.ts --reset` 후 전체+증분 재적재) 단계를 둔다.
