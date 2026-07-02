import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { WorkflowKind } from "@prisma/client";
import { auth } from "@/lib/auth";
import { mailRecipientKinds, sendStepsForKind } from "@/modules/workflows/policy";
import { recipientSetPutSchema } from "@/modules/workflows/validations";
import { saveRecipientSet } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../../_shared";

export async function PUT(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { kind: kindRaw } = await params;
  // D7: 발송 단계가 정의된 kind만(파생 단일 출처). 그 외 kind의 세트는 소비처 없는 死설정 — 400.
  // (kind는 공개 enum이라 게이트 전 400이어도 정보 노출 아님. 게이트는 서비스가 강제 — ForbiddenError→403.)
  if (!(mailRecipientKinds() as string[]).includes(kindRaw)) {
    return NextResponse.json({ error: "unsupported kind" }, { status: 400 });
  }
  const kind = kindRaw as WorkflowKind;
  try {
    const body = recipientSetPutSchema.parse(await req.json());
    // 전체 교체(§4.3) 계약 강제: step 키 집합이 D7 파생과 **정확히 일치**해야 한다. 초과 step은 死설정,
    // 누락 step은 부분 body가 다른 단계 세트를 조용히 지우는 경로(R1 high) — 둘 다 400.
    const required = sendStepsForKind(kind);
    const keys = Object.keys(body);
    if (required.some((s) => !keys.includes(s)) || keys.some((s) => !required.includes(s))) {
      return NextResponse.json({ error: `step set mismatch (required: ${required.join(",")})` }, { status: 400 });
    }
    const recipients = await saveRecipientSet(session.user.id, kind, body);
    if (!recipients) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ kind, recipients });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}
