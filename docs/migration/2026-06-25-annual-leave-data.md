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
