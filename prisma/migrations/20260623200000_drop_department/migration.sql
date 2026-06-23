-- DropDepartment (contract, PD1). 모든 reader가 teamId로 전환된 뒤 department 컬럼 제거.
-- drop 전 재단언: 미이관 멤버십(department NOT NULL AND teamId NULL)이 0이어야 한다(§4 step3 안전망).
BEGIN;

DO $$
DECLARE unmapped INTEGER;
BEGIN
  SELECT count(*) INTO unmapped FROM "kernel"."User"
  WHERE "department" IS NOT NULL AND "teamId" IS NULL;
  IF unmapped <> 0 THEN
    RAISE EXCEPTION 'department drop 차단: 미이관 멤버십 % 건(롤백)', unmapped;
  END IF;
END $$;

ALTER TABLE "kernel"."User" DROP COLUMN "department";

COMMIT;
