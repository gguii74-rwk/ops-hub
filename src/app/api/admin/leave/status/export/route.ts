import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllEmployeesStatus } from "@/modules/leave/services/status";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.status", "view");
    const rows = await getAllEmployeesStatus(year);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${year} 연차현황`);
    ws.columns = [
      { header: "이름", key: "name", width: 15 },
      { header: "이메일", key: "email", width: 30 },
      { header: "부서", key: "department", width: 15 },
      { header: "총 연차", key: "totalDays", width: 12 },
      { header: "사용 연차", key: "usedDays", width: 12 },
      { header: "대기 중", key: "pendingDays", width: 12 },
      { header: "잔여 연차", key: "remainingDays", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow({ ...r, department: r.department ?? "-" }));

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leave-status-${year}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return mapError(error);
  }
}
