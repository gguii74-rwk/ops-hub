-- task-06 적대검증 5R(M1): emailVerifyTokenHash 토큰 조회 DoS 방지 인덱스. 기존 migration 편집 대신 신규 migration으로 분리(체크섬 드리프트 방지).
CREATE INDEX "User_emailVerifyTokenHash_idx" ON "kernel"."User"("emailVerifyTokenHash");
