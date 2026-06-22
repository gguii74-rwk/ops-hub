-- 통합리뷰 finding(email 병합키 canonical): 대소문자 무시 로그인(findFirst mode:insensitive)을 DB 불변식으로 뒷받침한다.
-- write 경로(signup/resend/admin)는 이미 소문자로 저장하지만, DB 유니크가 case-sensitive면 마이그레이션/직접생성된
-- 케이스-only 중복행("Alice@x.com" vs "alice@x.com")이 같은 메일박스를 별도 신원으로 쪼개고, insensitive 로그인이
-- 임의 행을 고를 수 있다(중복+동일비번 시 타계정 인증 위험). lower(email) 유니크로 향후 케이스-only 중복을 차단한다.
--
-- 적용은 deploy 시점(현재 DB 미연결로 deferred — M1/M4 deferred 마이그레이션과 동일 운영).
-- ⚠️ 운영자 주의: (1)의 canonicalize가 기존 case-sensitive "email" UNIQUE를 위반하면(이미 케이스-only 중복 존재)
-- UPDATE가 실패한다 — 이는 의도된 fail-loud다. 신원 병합은 사람 판단이 필요하므로, 중복을 먼저 수동 정리한 뒤 재적용한다.
-- ⚠️ Prisma 제약: lower(email) 표현식 유니크 인덱스는 schema.prisma로 표현 불가 → raw SQL로 관리. 이후 `prisma migrate dev`가
--    이 인덱스를 drift로 감지할 수 있다(스키마 미반영). 의도된 외부관리 인덱스이므로 drop 제안을 수용하지 말 것.

-- (1) 기존 행 canonicalize: email을 소문자로 통일(이미 소문자면 no-op).
UPDATE "kernel"."User" SET "email" = lower("email") WHERE "email" <> lower("email");

-- (2) lower(email) 유니크 인덱스: 케이스만 다른 중복 신원 형성을 DB가 차단(앱 규약을 불변식으로 승격).
CREATE UNIQUE INDEX "User_email_lower_key" ON "kernel"."User" (lower("email"));
