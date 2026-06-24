---
name: permission-matrix-bulk-grant-pr
description: 권한 매트릭스 묶음 부여·역할 표시 순서/이름 개선 → PR #19 머지 + dev 배포 완료
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a2528fa-9446-434b-b81c-08ce05feee9c
---

권한 매트릭스 묶음 부여 + 역할 열 표시 순서·이름 개선. SDD 4태스크 → **PR #19 머지 완료 + dev 배포 완료**(2026-06-24).

- 머지 커밋 `ee2bc65`(merge commit, base main). 4 커밋: 2c62b3f(상수·getMatrix 정렬·seed명) · 5437419(묶음 백엔드 assertCellAllowed 추출+setRoleCellsBulk+bulk route) · 0481dcd(groupPermissions 순수헬퍼) · 5773ee0(매트릭스 UI 그룹 접기/펼치기+일괄 셀렉트).
- 검증: typecheck/lint/build(53p)/test **1291/1291**. task 리뷰 4 + 최종 whole-branch 리뷰(opus) clean, escalation hole 없음.
- 핵심 불변식 유지: 묶음도 단건과 동일 anti-escalation 가드(configure ALLOW 차단·비특권×critical ALLOW 차단), 비-OWNER fail-closed, `setCell`(F-H/F-BB/audit) 무변경·셀당 재사용, 단건 회귀 0.
- **dev 배포(kgs-dev, main ee2bc65):** pull→npm ci→prisma:generate→migrate deploy(no-op, 스키마 변경 없음)→db:seed→db:seed:demo→build(53p)→pm2 restart. 역할 표시명 DB 반영 확인: admin=관리자, contractor-content=콘텐츠관리, contractor-civil-response=민원응대. /login·/signup 200, 보호 라우트 307/401 정상.
- ⚠️ 배포 중 발견: kgs-dev에 **수정 전 stale 빌드가 돌고 있어** advisory-lock 경로(signup/leave승인/매트릭스/nav 편집)에서 P2010(void) 사일런트 크래시 중이었음 → 이 배포(93d0cec 포함)가 해소. 상세 [[dev-deploy-stale-build-p2010]].
