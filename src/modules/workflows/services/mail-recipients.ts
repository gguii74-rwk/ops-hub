import "server-only";
import type { WorkflowKind } from "@prisma/client";
import { ForbiddenError, hasPermission } from "@/kernel/access";
import { mailRecipientKinds, sendStepsForKind } from "../policy";
import { normalizeStoredEmails, type DefaultRecipientsMap, type RecipientFields } from "../recipients";
import {
  listContacts, createContact, updateContactNameMemo, deleteContactById,
  findDefaultRecipientsByKind, updateDefaultRecipientsByKind,
} from "../repositories/mail-recipients";

// D6: 관리 읽기·쓰기 동일 교집합 게이트. OWNER는 hasPermission이 자동 허용. 둘 중 하나라도 없으면 거부(fail-closed).
// 페이지(서버 컴포넌트)의 redirect 판단용 boolean — API 경로는 아래 require가 서비스 내부에서 강제한다.
export async function canManageMailRecipients(userId: string): Promise<boolean> {
  return (
    (await hasPermission(userId, "admin.settings", "configure")) &&
    (await hasPermission(userId, "workflows.mail", "configure"))
  );
}

// 서비스가 authz 권위(billing config 등 workflows 서비스 패턴) — 라우트 규율에 의존하지 않는다.
// 후속 서버 컴포넌트/라우트가 이 서비스를 직접 재사용해도 게이트를 우회할 수 없다(접근제어 규칙①②).
async function requireManageMailRecipients(userId: string): Promise<void> {
  if (!(await canManageMailRecipients(userId))) {
    throw new ForbiddenError("메일 수신자 관리 권한이 없습니다.");
  }
}

export interface MailContactView { id: string; email: string; name: string; memo: string | null }

export async function listMailContacts(userId: string): Promise<MailContactView[]> {
  await requireManageMailRecipients(userId);
  return listContacts();
}

// email은 trim+소문자로 정규화 저장(D2). 유니크 충돌은 레포가 ConflictError로 정규화 → 라우트 409.
export async function addMailContact(userId: string, input: { email: string; name: string; memo?: string }): Promise<MailContactView> {
  await requireManageMailRecipients(userId);
  return createContact({
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    memo: input.memo?.trim() ? input.memo.trim() : null,
  });
}

export async function editMailContact(userId: string, id: string, input: { name: string; memo?: string }): Promise<MailContactView | null> {
  await requireManageMailRecipients(userId);
  return updateContactNameMemo(id, {
    name: input.name.trim(),
    memo: input.memo?.trim() ? input.memo.trim() : null,
  });
}

export async function removeMailContact(userId: string, id: string): Promise<boolean> {
  await requireManageMailRecipients(userId);
  return deleteContactById(id); // 세트 잔존 email과 무관(D12)
}

export interface RecipientSetView { kind: WorkflowKind; steps: string[]; recipients: DefaultRecipientsMap }

// D7: SEND_STEP_TRANSITION 파생 kind만 노출. 미저장 step은 빈 필드로 채워 UI가 바로 그린다.
export async function getRecipientSets(userId: string): Promise<RecipientSetView[]> {
  await requireManageMailRecipients(userId);
  const out: RecipientSetView[] = [];
  for (const kind of mailRecipientKinds()) {
    const stored = (await findDefaultRecipientsByKind(kind)) ?? {};
    const steps = sendStepsForKind(kind);
    const recipients: DefaultRecipientsMap = {};
    for (const step of steps) recipients[step] = stored[step] ?? { to: [], cc: [], bcc: [] };
    out.push({ kind, steps, recipients });
  }
  return out;
}

// 전체 교체 저장. 필드별 trim·소문자·dedup(§3 — 주소록 조인 매칭 일관). kind·step 검증은 라우트(400).
export async function saveRecipientSet(userId: string, kind: WorkflowKind, map: Record<string, RecipientFields>): Promise<DefaultRecipientsMap | null> {
  await requireManageMailRecipients(userId);
  const normalized: DefaultRecipientsMap = {};
  for (const [step, f] of Object.entries(map)) {
    normalized[step] = { to: normalizeStoredEmails(f.to), cc: normalizeStoredEmails(f.cc), bcc: normalizeStoredEmails(f.bcc) };
  }
  const ok = await updateDefaultRecipientsByKind(kind, normalized);
  return ok ? normalized : null;
}
