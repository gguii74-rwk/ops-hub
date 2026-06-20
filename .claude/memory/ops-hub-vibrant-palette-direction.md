---
name: ops-hub-vibrant-palette-direction
description: ops-hub 디자인은 중립 그레이스케일 대신 비비드 파스텔 팔레트(Novera 참조) + Playfair Display 방향을 지향
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9762149d-bd3b-4969-9da3-5a725c7ad750
---

사용자는 ops-hub 기본 색상을 더 "감각적인(vibrant/sensory)" 방향으로 원함. 참조: Novera 핀테크 대시보드 무드보드 2장(2026-06-18 제공).

참조 팔레트(브랜딩 보드 명시 hex):
- `#BA8DFF` 라벤더/퍼플 — 주 액센트(카드 fill, 카드 배경)
- `#FBC6F2` 소프트 핑크 — 보조 액센트(프리미엄/하이라이트 카드)
- `#24D0FE` 비비드 시안 — 데이터/차트 액센트
- `#EAFF00` 라임 옐로 — 포인트 하이라이트
- 표면은 깨끗한 화이트/연그레이, 텍스트·주요 CTA는 블랙. 둥근 카드 + pill 내비.
- 디스플레이 서체: **Playfair Display**(세리프, 헤딩용).

**Why:** 현재 디자인 시스템 기반(`feat/design-system-foundation`)은 shadcn식 중립 그레이스케일 토큰(red destructive만 유채색)으로 의도적으로 무채색이다. 사용자는 이걸 위 비비드 파스텔 무드로 바꾸고 싶어 함 — "앞으로 디자인에 참고."

**How to apply:** 토큰 기반이라 구조/프리미티브 변경 없이 `globals.css @theme`의 색 토큰 VALUE 교체 + 브랜드 액센트 토큰 추가(예: cyan/lime) + Playfair Display를 `--font-display`로 헤딩에 적용하면 됨(본문 sans는 [[?]] 유지 검토). 단 ops-hub는 내부 업무 허브라 소비자 핀테크만큼의 채도는 톤다운이 필요할 수 있음 — 다크모드 대비/접근성(WCAG) 함께 검토. 이 작업은 별도 "브랜드 팔레트 패스"로 brainstorming 후 진행 권장. 관련: 디자인 시스템 기반 spec `docs/specs/2026-06-18-design-system-foundation-design.md`.
