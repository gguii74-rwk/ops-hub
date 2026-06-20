"use client";
import { MyHistory } from "./my-history";
import { AdminHistory } from "./admin-history";

export function HistoryClient({
  canAdminView,
  canUpdate,
  canDelete,
  canApprove,
}: {
  canAdminView: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  // leave.admin:view 보유 시 전체 내역(AdminHistory), 아니면 본인 내역(MyHistory).
  return canAdminView ? (
    <AdminHistory canUpdate={canUpdate} canDelete={canDelete} canApprove={canApprove} />
  ) : (
    <MyHistory />
  );
}
