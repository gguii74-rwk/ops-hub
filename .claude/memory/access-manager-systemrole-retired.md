---
name: access-manager-systemrole-retired
description: MANAGER systemRole 폐지(미사용 등급) — UI·API·federation 신규부여 차단·enum 보존, main acaaffe + dev 배포 완료(MANAGER 0명 확인)
metadata:
  type: project
---

MANAGER systemRole 폐지. 권한 엔진(`kernel/access`)에서 MEMBER와 동일·특권 없어 실질 역할이 없었음 → 신규 부여 차단. main 머지 `acaaffe`(2026-06-24).

- **차단 3경로**: UI 드롭다운(`SYSTEM_ROLE_OPTIONS`), API zod(`systemRole` 3값=OWNER/ADMIN/MEMBER), federation `ops-manager` 그룹 발급.
- **보존**: DB `SystemRole` enum 값·TS 타입·`SYSTEM_ROLE_LABEL` 유지(비가역 마이그레이션 회피). 편집 PATCH는 unchanged `systemRole`을 생략 → 기존 MANAGER도 이름·팀·속성 편집 가능.
- 위임 관리는 ADMIN systemRole + `admin` AccessRole로 표현. 운영 등급 = OWNER/ADMIN/MEMBER 3단계.
- 결정 SSOT: ADR-0002 갱신 + `docs/architecture/access-control.md`. 적대검증 2R(F-1 편집보존 FIXED, F-2 federation ACCEPTED).
- ⚠️ **배포 전 게이트**: ① opshub DB 잔존 MANAGER 0명(`SELECT count(*) FROM kernel."User" WHERE "systemRole"='MANAGER'`) ② 외부 소비자 `ops-manager` 미의존. 마이그레이션 없음=표준 restart, `db:seed` 불필요. 배포 smoke는 [[dev-deploy-stale-build-p2010]] 따라 인증+advisory 라우트까지(=/login 200만으론 부족). 접속·경로는 [[ops-hub-phone-test-via-dev-deploy]].
- ✅ **dev 배포 완료**(kgs-dev, 2026-06-24): 게이트 MANAGER=**0** 확인 → `git pull`(acaaffe)→`npm run build`→`pm2 restart ops-hub`(db:seed/migrate 생략, 무변경). smoke `/login`·`/signup` 200·`/admin/users` 307·pm2 `Ready` 에러 없음. 게이트②(ops-manager 외부 미의존)는 federation 실연동/cutover 시 재확인.
