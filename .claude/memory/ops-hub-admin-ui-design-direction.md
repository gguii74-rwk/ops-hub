---
name: ops-hub-admin-ui-design-direction
description: "ops-hub 관리 4화면 UI 디자인 확정 = Aurora(B구조+C컬러칩), 메뉴트리=Handle Cards 드래그정렬"
metadata: 
  node_type: memory
  type: project
  originSessionId: 93e8270d-efc3-4f91-bea6-000e8e80055a
---

ops-hub 관리 콘솔 4화면(사용자·메뉴·팀·권한)의 데이터 표출 UI 디자인을 **Aurora**로 확정(2026-06-24, 시안 3차 비교 후 사용자 선택).

**Aurora = B 구조 + C 컬러칩**
- B(구조): 화면 상단 **요약 통계 스트립**(예: 대기/전체/활성/외주) → 흰 **카드** → **pill 툴바**(필터). PageHeader 패턴(eyebrow 대문자 라벨 + 타이틀 + 부제) 4화면 통일.
- C(컬러칩): 상태·고용형태·직무·역할을 **채움형 컬러 코딩 칩**으로(활성=green, 비활성=gray, 정규=blue, 외주=amber, 개발=blue, 콘텐츠=purple, 민원=orange, 관리자=admin pink).

**메뉴 트리 = 변형 1 · Handle Cards**(메뉴만 별도 비교 후 확정)
- 각 메뉴 = 카드 행, 왼쪽 **드래그 핸들(⠿)**. 자식은 들여쓰기+연결선. 활성 토글·권한칩 한 줄.
- 드래그 순서변경은 **같은 부모 안에서만**(pointer 기반, 터치 포함) → 기존 `reorder` API(형제별 updatedAt 낙관락)에 매핑. **부모 변경(reparent)은 드래그 제외**, 현행 방식 유지(cascade·권한 검증 복잡). reparent 드래그는 사용자 추가 요청 시만.

**공통 개선점**: ① PageHeader 통일(팀·권한 화면이 자체 text-xl로 놂), ② raw role key(`contractor-civil-response`)→표시명(`민원응대`), ③ 네이티브 `<select>` 제거(팀 팀장·매트릭스 셀), ④ 권한 매트릭스 셀=컬러 세그먼트 토글(ALLOW=brand/DENY=rose), PM 열 잠금.

**구현 완료 → PR #21 머지 + dev 배포 완료**(2026-06-24): SDD 7태스크 전부 완료·태스크별 리뷰 clean·최종 whole-branch 리뷰(opus) **Ready to merge=YES**. 브랜치 `feat/admin-console-redesign`(main 76eda59 분기, HEAD b829f24). 게이트: typecheck/lint 0(set-state-in-effect 0)·test 1322·build 53p. 커밋/PR본문 no-AI-trace 확인.
- **PR #21 → main 머지**(merge commit `9a0692e`, gh api REST). 로컬 main FF 동기화.
- **kgs-dev 배포 완료**: pull FF(348331c→9a0692e)→npm ci→prisma:generate→migrate deploy(**No pending migrations**=rolling 안전)→db:seed(permissions=48/roles=6/nav=5)→db:seed:demo→build→pm2 restart ops-hub. smoke: /login 200·/signup 200·/dashboard 307·/api/admin/users 401·/api/calendar/feed 401(500 없음). **P2010 stale 잔류는 fresh build로 해소**(flush 후 신규 0). `:3210` mockup 서버+`/home/kgs/mockups` 정리 완료.
- ⚠ 서버 `NEXTAUTH_URL`=LAN(172.21.10.27:3200) → 사무실 LAN 로그인만 동작. **휴대폰 드래그 smoke 하려면** `.env` NEXTAUTH_URL을 100.66.58.66로 바꾸고 `pm2 restart ops-hub`. 인증된 advisory 경로(matrix/leave)는 직접 미검증(이 PR=순수 UI·advisory 코드 무변경이라 회귀 불가).
- 구현물: 프리미티브 `Chip·Switch·StatStrip/Stat·Toolbar/Pill`(`src/components/ui/`) + `PageHeader.eyebrow`; `labels.ts` 톤/표시명 맵; `listUsers.stats`(읽기전용 집계); 4화면(users-list·teams-editor·matrix-editor·navigation-editor) Aurora 재조립. 표현 계층만 교체 — 접근제어·낙관락·RolePreview 가드·setCell/bulkSet·reparent/delete TOCTOU 전부 불변(코드 diff로 검증).
- 컬러칩=Tailwind 기본+globals.css 테마 토큰(brand·nav-*), 토큰 추가 없음. 메뉴 드래그 핸들=포인터+키보드(↑↓) 겸용, 같은 부모 내만.
- **배포 follow-up**: 휴대폰 메뉴 드래그/키보드 재정렬 smoke 권장(런타임-only, 자동 게이트 미커버). 시안 정적서버 `:3210` 정리(`pkill -f "http.server 3210"` + `/home/kgs/mockups`).
- 시안 파일 scratchpad `admin-design-v2.html`(Aurora/Atlas)·`menu-tree-options.html`(변형1~3). 기존 구현은 [[sidebar-tree-submenu-merge-ready]]·[[navigation-cms-merge-ready]] 참조.
