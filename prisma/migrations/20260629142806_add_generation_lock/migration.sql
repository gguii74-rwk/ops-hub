-- AddGenerationLock (J1 lease, 비파괴 추가). generate 직렬화 primitive.
-- CAS: INSERT … ON CONFLICT … WHERE lockedUntil < now()로 원자적 점유/steal.
-- 비파괴 테이블 추가 → 표준 restart(full-stop 불필요).
-- lockedUntil은 TIMESTAMPTZ(3): raw SQL `lockedUntil < now()` 만료 비교가 DB 세션 TimeZone에 의존하지 않게
-- 절대 instant로 저장(R7-1). 일반 TIMESTAMP면 비-UTC DB에서 single-flight(J1)가 깨진다.
CREATE TABLE "workflows"."GenerationLock" (
    "taskId"      TEXT NOT NULL,
    "holder"      TEXT NOT NULL,
    "lockedUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenerationLock_pkey" PRIMARY KEY ("taskId")
);
