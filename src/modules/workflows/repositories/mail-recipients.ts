import "server-only";
import { Prisma } from "@prisma/client";
import type { WorkflowKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "../types";
import { parseDefaultRecipients, type DefaultRecipientsMap } from "../recipients";

export interface MailContactRow { id: string; email: string; name: string; memo: string | null }
const CONTACT_SELECT = { id: true, email: true, name: true, memo: true } as const;

export async function listContacts(): Promise<MailContactRow[]> {
  return prisma.mailContact.findMany({ select: CONTACT_SELECT, orderBy: { email: "asc" } });
}

export async function createContact(data: { email: string; name: string; memo: string | null }): Promise<MailContactRow> {
  try {
    return await prisma.mailContact.create({ data, select: CONTACT_SELECT });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("이미 등록된 이메일입니다.");
    }
    throw e;
  }
}

// D15: email 불변 — name·memo만 갱신. 대상 없으면 null(라우트 404).
export async function updateContactNameMemo(id: string, data: { name: string; memo: string | null }): Promise<MailContactRow | null> {
  try {
    return await prisma.mailContact.update({ where: { id }, data, select: CONTACT_SELECT });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return null;
    throw e;
  }
}

export async function deleteContactById(id: string): Promise<boolean> {
  try {
    await prisma.mailContact.delete({ where: { id } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return false;
    throw e;
  }
}

// D8 enrich용 — 세트에 등장한 email만 조회(주소록 전체 미노출). 키 = 소문자 email(D2 저장 규약과 일치).
export async function findContactNamesByEmails(emails: string[]): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const rows = await prisma.mailContact.findMany({
    where: { email: { in: [...new Set(emails.map((e) => e.toLowerCase()))] } },
    select: { email: true, name: true },
  });
  return new Map(rows.map((r) => [r.email, r.name]));
}

export async function findDefaultRecipientsByKind(kind: WorkflowKind): Promise<DefaultRecipientsMap | null> {
  const t = await prisma.workflowType.findUnique({ where: { kind }, select: { defaultRecipients: true } });
  if (!t) return null;
  return parseDefaultRecipients(t.defaultRecipients);
}

// 전체 교체 저장(§4.3). WorkflowType 행 없으면 false(라우트 404).
export async function updateDefaultRecipientsByKind(kind: WorkflowKind, map: DefaultRecipientsMap): Promise<boolean> {
  try {
    await prisma.workflowType.update({ where: { kind }, data: { defaultRecipients: map as unknown as Prisma.InputJsonValue } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return false;
    throw e;
  }
}
