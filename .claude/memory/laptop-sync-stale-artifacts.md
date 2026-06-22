---
name: laptop-sync-stale-artifacts
description: 노트북 전환 후 typecheck 거짓 실패가 나면 stale Prisma client·stale .next 때문 — prisma:generate + rm .next 먼저
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f0b63fc-ac23-4bf4-af86-4cf079e6c9b6
---

두 노트북(OMEN/그램) 교대 작업에서 `node_modules`·생성 산출물은 git 동기화가 안 된다. 그래서 다른 노트북이 스키마/라우트를 바꾼 브랜치를 받아오면 **이 노트북의 생성물이 stale**해 typecheck가 **거짓 실패**한다.

**증상→원인:**
- `MailDeliveryStatus`에 PENDING/CANCELLED 없음, `LeaveRequestWhereInput`에 `deletedAt` 없음 등 Prisma 타입 누락 → **stale Prisma Client** → `npm run prisma:generate`.
- `.next/types/validator.ts`가 존재하지 않는 페이지(`(app)/admin/leave/...`) 못 찾음 → **stale `.next` 빌드 캐시(이전 브랜치)** → `rm -rf .next` 후 `npm run build`.

**Why:** 코드 회귀가 아니라 환경 아티팩트인데 머지 직전 게이트에서 진짜 실패로 오인하기 쉽다.

**How to apply:** 노트북 전환/브랜치 pull 직후 게이트가 깨지면 코드를 의심하기 전에 `prisma:generate` + `rm -rf .next` 후 재실행. 2026-06-22 user-management 머지 준비 때 실제로 발생, 둘 다 처리하니 1002 테스트·typecheck 전부 green.

관련: [[commit-verify-current-branch]] [[memory-sync-key-mismatch]].
