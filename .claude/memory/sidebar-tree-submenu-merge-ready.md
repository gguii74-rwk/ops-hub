---
name: sidebar-tree-submenu-merge-ready
description: 사이드바 트리 중메뉴 일원화 → PR #13(코드)·#14(docs) 머지 완료 + dev 배포 완료(2026-06-23); 연차 5자식·관리 사용자관리·/leave/manage 이동
metadata:
  type: project
---

`feat/sidebar-tree-submenu`(spec/plan/impl + 2단계 적대검증 완료) → **머지+dev 배포 완료**(2026-06-23). 코드 4커밋은 **PR #13**(`6990f4a`)로 먼저 머지됨, **PR #14**(`4d95b01`)는 plan 적대검증 판정 기록 docs 1커밋뿐. 연차 중메뉴를 사이드바 트리 5자식(대시보드/연차 신청/캘린더/연차 내역/연차 관리)으로, 관리에 사용자 관리 자식 추가. 연차 관리 3종은 `/leave/manage/*`로 이동(승인=인덱스) + 페이지 내 `ManageTabs`. `LeaveTabs`/중복 `AdminLinks` 제거. active 판정은 형제 최장 매칭으로 정밀화.

**Why:** 세션-단위-머지([[session-per-merge-workflow]]). 핸드오프엔 "PR #14 머지 대기"였으나 실제로는 같은 브랜치가 PR #13으로 먼저 머지돼 코드는 이미 main에 있었음 — 다른 노트북 세션 작업으로 추정.

**How to apply:** dev 배포(kgs-dev `/home/kgs/apps/ops-hub`, pm2 `ops-hub`:3200) 완료 — pull→npm ci→migrate(pending 0)→`db:seed`(nav=5 트리 등록, F1 재시드)→db:seed:demo→build→pm2 restart. 검증: `/login` 200(LAN `http://172.21.10.27:3200`). 폰 테스트는 서버 `.env` `NEXTAUTH_URL`을 100.66.58.66로 바꾸고 restart 필요(현재 LAN). 적대검증 F2 구 라우트 404·F3 단일 게이트는 spec D5/D9 의도로 ACCEPTED. 연계: [[navigation-cms-merge-ready]], [[ops-hub-owner-email-changed]].
