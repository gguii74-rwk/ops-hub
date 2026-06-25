---
name: annual-leave-data-migrated
description: annual-leave 연차 데이터(할당25·신청120·이력15)를 dev opshub에 적재 완료(2026-06-25) + 운영 cutover 증분 워터마크
metadata: 
  node_type: memory
  type: project
  originSessionId: 98165331-9898-4aa6-89e3-3130020ece08
---

2026-06-25 annual-leave 운영 SQLite의 **연차 데이터**를 kgs-dev opshub(:5433)에 적재 완료(사용자 계정 이전 [[annual-leave-users-migrated]]의 후속). SSH로 서버에서 export→dry-run→적재→DB검증.

- **적재**: LeaveAllocation 25 / LeaveRequest 120 / LeaveAllocationHistory 15(소스 uuid id 보존). ggui74(OWNER) 본인 데이터 제외. 신청 상태 = APPROVED 99·REJECTED 4·CANCELLED 18·**PENDING 0**(소스에 미결 없음 → 승인 큐 테스트는 db:seed:demo 데모로). usedDays는 APPROVED days 합으로 재계산(1건 보정 2→2.25). opshub에 없는 검토자/생성자 참조 15건 null.
- 스크립트(main): `scripts/migrate-al-leave-export.py`(읽기전용 export)·`scripts/migrate-al-leave.ts`(email FK remap·id 보존·opshub 가드·`--dry-run`/`--reset`·트랜잭션 skip-duplicate). 설계·매핑·실행기록 = `docs/migration/2026-06-25-annual-leave-data.md`.
- 서버 git만 `6764722`로 전진, **src·schema 무변경이라 재빌드/재시작 없이** 앱이 데이터 바로 읽음.

**운영 cutover 증분(delta) 워터마크 — 이후 증분만 가져올 때 사용:** 소스 SQLite 타임스탬프는 **epoch ms**. 머신 워터마크 **T=`1781660787623`(=2026-06-17 10:46:27 KST, requests·allocations `max(updatedAt)`)**. 증분 추출 = requests/allocations `updatedAt > T`, history `createdAt > T`. 증분 적재는 현 create-only 대신 **upsert(by 보존 id)**로 바꾸고, 영향 `(userId,year)` usedDays **전체 재계산** 필요. 한계: 타임스탬프 워터마크는 **하드삭제 미포착**. **결정(2026-06-25): 현재 dev opshub DB(kgs-dev :5433)를 그대로 운영 DB로 사용** → 증분 전략 정식 채택(새 DB 미생성, 전체 재마이그레이션 아님). ⚠ cutover 필수 선행 = **dev 테스트 산출물 제거**(db:seed:demo 데모 leave·승인큐 테스트 PENDING 등 — 소스에 없는 dev측 데이터라 안 지우면 운영 오염). cutover 맥락 [[ops-hub-cutover-target]], 상위계획 `docs/migration/initial-migration-plan.md` §7-2.
