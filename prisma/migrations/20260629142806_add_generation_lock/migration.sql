-- AddGenerationLock (J1 lease, 비파괴 추가). generate 직렬화 primitive.
-- CAS: INSERT … ON CONFLICT … WHERE lockedUntil < now()로 원자적 점유/steal.
-- 비파괴 테이블 추가 → 표준 restart(full-stop 불필요).
CREATE TABLE "workflows"."GenerationLock" (
    "taskId"      TEXT NOT NULL,
    "holder"      TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenerationLock_pkey" PRIMARY KEY ("taskId")
);
