---
name: ops-hub-owner-email-changed
description: ops-hub dev OWNER 로그인 ID가 admin@uracle.co.kr에서 ggui74@uracle.co.kr로 변경됨
metadata: 
  node_type: memory
  type: project
  originSessionId: ebe7f84a-3d39-424d-b529-175b9aadfaf0
---

2026-06-22 dev opshub의 OWNER 계정 이메일을 `admin@uracle.co.kr` → `ggui74@uracle.co.kr`로 변경(사용자 본인 계정 통일). 비밀번호는 그대로(서버 `.env` `SEED_ADMIN_PASSWORD`). 서버 `.env`에 `SEED_ADMIN_EMAIL="ggui74@uracle.co.kr"` 추가 — 없으면 기본값 `admin@`로 `db:seed` 시 OWNER가 부활하는 함정(백업 `.env.bak-pre-seedadmin-email`).

**향후 dev(:3200) 로그인은 `ggui74@uracle.co.kr`로** 한다(이전 핸드오프/INVENTORY의 admin@ 표기는 구식). [[annual-leave-users-migrated]]
