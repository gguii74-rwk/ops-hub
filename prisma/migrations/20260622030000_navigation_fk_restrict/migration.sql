-- NavigationItem FK 동작을 RESTRICT로 변경(fail-closed). 컬럼 변경 없음.
-- ① requiredPermissionId: 참조 Permission 삭제 시 메뉴가 공개로 전락하는 것 방지(D8/F-3).
-- ② parentId(self-ref): 부모 삭제 시 자식 top-level 고아화·cascade 레이스 방지(D11/F-4).

ALTER TABLE "kernel"."NavigationItem" DROP CONSTRAINT "NavigationItem_parentId_fkey";
ALTER TABLE "kernel"."NavigationItem" DROP CONSTRAINT "NavigationItem_requiredPermissionId_fkey";

ALTER TABLE "kernel"."NavigationItem" ADD CONSTRAINT "NavigationItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "kernel"."NavigationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kernel"."NavigationItem" ADD CONSTRAINT "NavigationItem_requiredPermissionId_fkey" FOREIGN KEY ("requiredPermissionId") REFERENCES "kernel"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
