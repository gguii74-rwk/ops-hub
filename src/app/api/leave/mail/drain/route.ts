import { NextResponse } from "next/server";
import { drainLeaveMailOutbox } from "@/modules/leave/services/mail";

// 시스템 cron이 주기 호출(누락 보충, at-least-once). 세션이 아니라 공유 토큰으로 가드.
export async function POST(req: Request) {
  const expected = process.env.LEAVE_MAIL_DRAIN_TOKEN;
  if (!expected || req.headers.get("x-drain-token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await drainLeaveMailOutbox();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
