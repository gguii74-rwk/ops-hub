---
name: annual-leave-users-migrated
description: annual-leave 운영 사용자 16명을 dev opshub로 마이그레이션 완료(2026-06-22)
metadata: 
  node_type: memory
  type: project
  originSessionId: ebe7f84a-3d39-424d-b529-175b9aadfaf0
---

2026-06-22 annual-leave 운영 사용자 → dev opshub(:5433) 적재 완료.

- **출처**: kgs-dev `/opt/annual-leave/backend/prisma/database.sqlite` (root PM2 `/root/.pm2`로 운영, :3000/:5000, 18명). 읽기전용으로만 접근. 로컬 repo의 `prisma/prisma/database.sqlite`는 빈 개발 DB라 무용.
- **적재 16명**: ggui74@(OWNER로 이미 존재 → 병합 skip)·이병규 hatecoding@(퇴사) 제외. 비번 `$2b$10$` 해시 그대로 이전 → 재로그인 가능. status active→ACTIVE/inactive→DISABLED.
- **매핑**: department→jobFunction(개발/관리자→DEVELOPER, 컨텐츠→CONTENT_MANAGER, 민원→CIVIL_RESPONSE), uracle.co.kr→REGULAR/그외→CONTRACTOR, 조합으로 seed AccessRole 부여. kimkfc(개발팀 PL)=ADMIN+admin role.
- 상세·스크립트: `docs/migration/2026-06-22-annual-leave-users.md`, `scripts/migrate-al-users*.{ts,py}` (브랜치 `chore/migrate-al-users`, create-only·opshub 가드). **연차 데이터(allocation/request)는 미이전**(이번 범위 아님).

[[ops-hub-owner-email-changed]] · cutover 맥락 [[ops-hub-cutover-target]]
