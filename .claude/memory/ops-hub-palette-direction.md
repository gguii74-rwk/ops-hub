---
name: ops-hub-palette-direction
description: ops-hub 팔레트 방향은 프로페셔널 블루·슬레이트(brand #2563EB 등)로 확정 — 이전 비비드 파스텔(#BA8DFF) 지향은 폐기됨
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9762149d-bd3b-4969-9da3-5a725c7ad750
---

2026-06-23 사용자 결정: ops-hub 팔레트를 **프로페셔널 블루·슬레이트**로 확정(이전 비비드 파스텔 지향 폐기). PR #11로 `globals.css` 전면 교체 **머지 완료**(main 4c79ba2). 단, 같은 날 사용자가 "**디자인은 차후 전체적으로 다시 정리**"하기로 함 → 현 팔레트는 **interim 베이스라인**(최종 아님). 차후 종합 디자인 패스에서 admin 셸·calendar/leave 심화까지 함께 정리 예정([[navigation-cms-merge-ready]]).

확정 팔레트(`globals.css @theme`, 라이트·다크 동시):
- brand `#2563EB`(블루) / brand-2 `#F43F5E`(로즈) / chart-cyan `#06B6D4` / point-lime `#A3E635`
- per-섹션 nav 톤(app-nav.tsx 소비): dashboard `#2563EB` · calendar `#0891B2` · workflows `#F97316` · leave `#059669` · admin `#C026D3`
- 표면 슬레이트 계열(muted `#F1F5F9`, border `#D7DEE8`, page `#F5F7FA`), ring `#2563EB`. 헤딩 서체 **Playfair Display**(`--font-display`)는 유지.

**Why:** 이전 메모리는 Novera 무드보드 기반 비비드 파스텔(보라/핑크/시안/라임)을 지향으로 기록했으나, 내부 업무 허브 성격상 사용자가 더 차분한 프로페셔널 SaaS 톤(블루/슬레이트 + per-도메인 semantic 색)으로 방향을 바꿈. app-nav 아코디언이 이미 `text-blue-800`/`emerald` 등 semantic 톤을 전제하고 있어 코드와도 일관.

**How to apply:** `globals.css @theme` 색 토큰이 SSOT. 비비드 파스텔 hex(`#BA8DFF`/`#FBC6F2`/`#24D0FE`/`#EAFF00`)는 더 이상 쓰지 않음. 신규 도메인 화면은 brand/nav-*/chart-cyan semantic 토큰을 소비. 관련: [[navigation-cms-merge-ready]].

**DEFERRED:** admin 셸 리팩터(admin-links 삭제·`/admin` 리다이렉트·h1 제거)는 `admin-tabs.tsx`(task-11 Step 4, `fix/admin-submenu-tabs` 소재)가 헤딩을 제공한다는 전제 → admin 서브탭 작업과 묶어 별도 진행. 단독 적용 시 admin 페이지 제목 회귀.
