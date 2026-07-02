import "server-only";
import type { WorkflowKind, WorkflowStatus, MailDeliveryStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { KIND_RESOURCE, sendStepsForKind } from "../policy";
import { findTaskList, findTaskDetail } from "../repositories";
import { findContactNamesByEmails } from "../repositories/mail-recipients";
import type { DefaultRecipientsMap, EffectiveRecipientsMap, RecipientEntry } from "../recipients";

export interface TaskListItem { id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus; }
export interface TimelineEntry { id: string; fromStatus: WorkflowStatus | null; toStatus: WorkflowStatus; actorId: string | null; note: string | null; occurredAt: string; }
export interface MailView {
  id: string; step: string | null; recipients: string[]; cc: string[]; bcc?: string[];
  subject: string; status: MailDeliveryStatus; errorMessage: string | null; sentAt: string | null;
}
export interface FileView { id: string; displayName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; }
export interface TaskDetailView {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: EffectiveRecipientsMap; // :send 권한자에게만(D8) — 단계별 {to,cc,bcc} enrich 맵. 없으면 필드 생략.
}

const asEmails = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

// D8: type.defaultRecipients에서 파생한 단계별 맵 + 주소록 조인 enrich.
// 세트에 등장한 email만 조회(주소록 전체 미노출 — backend-minimal-data). 미저장 step은 빈 필드.
async function buildEffectiveRecipients(kind: WorkflowKind, map: DefaultRecipientsMap | null): Promise<EffectiveRecipientsMap> {
  const steps = sendStepsForKind(kind);
  const fields = (s: string) => map?.[s] ?? { to: [], cc: [], bcc: [] };
  const emails = [...new Set(steps.flatMap((s) => { const f = fields(s); return [...f.to, ...f.cc, ...f.bcc]; }))];
  const names = emails.length > 0 ? await findContactNamesByEmails(emails) : new Map<string, string>();
  const enrich = (list: string[]): RecipientEntry[] =>
    list.map((email) => { const name = names.get(email.toLowerCase()); return name ? { email, name } : { email }; });
  const out: EffectiveRecipientsMap = {};
  for (const s of steps) { const f = fields(s); out[s] = { to: enrich(f.to), cc: enrich(f.cc), bcc: enrich(f.bcc) }; }
  return out;
}

// 조회 allow-list 단일 출처(F1): 완전매핑 Record에서 파생 → 신규 kind가 typecheck 없이 자동 포함.
const ALL_KINDS = Object.keys(KIND_RESOURCE) as WorkflowKind[];

function allowedKinds(keys: Set<string>): WorkflowKind[] {
  return ALL_KINDS.filter((k) => keys.has(`${KIND_RESOURCE[k]}:view`));
}

export async function getTaskList(
  ctx: { permissionKeys: Set<string> },
  filter: { statuses?: WorkflowStatus[]; start?: Date; end?: Date },
): Promise<TaskListItem[]> {
  const kinds = allowedKinds(ctx.permissionKeys);
  const rows = await findTaskList({ kinds, statuses: filter.statuses, start: filter.start, end: filter.end });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    typeName: r.typeName,
    scheduledAt: r.scheduledAt.toISOString(),
    status: r.status,
  }));
}

// 캘린더 전용 조회(D5). start/end 비-optional = 타입-레벨 range 계약(서버가 무제한 조회를 구조적으로 차단).
// 런타임 방어로 start<end 강제(RangeError). kind 필터는 응답을 받은 클라가 수행(kind는 민감정보 아님, D5).
export async function getCalendarTasks(
  ctx: { permissionKeys: Set<string> },
  range: { start: Date; end: Date },
): Promise<TaskListItem[]> {
  if (!(range.start.getTime() < range.end.getTime())) {
    throw new RangeError("조회 범위가 올바르지 않습니다(start<end).");
  }
  const kinds = allowedKinds(ctx.permissionKeys);
  const rows = await findTaskList({ kinds, start: range.start, end: range.end });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    typeName: r.typeName,
    scheduledAt: r.scheduledAt.toISOString(),
    status: r.status,
  }));
}

// 없으면 null(라우트가 404), 권한 없으면 ForbiddenError(403). kind를 알아야 권한을 판정하므로 먼저 로드한다.
export async function getTaskDetailView(
  id: string,
  ctx: { permissionKeys: Set<string> },
): Promise<TaskDetailView | null> {
  const t = await findTaskDetail(id);
  if (!t) return null;
  if (!ctx.permissionKeys.has(`${KIND_RESOURCE[t.kind]}:view`)) throw new ForbiddenError("열람 권한이 없습니다.");
  const canSend = ctx.permissionKeys.has(`${KIND_RESOURCE[t.kind]}:send`);
  const view: TaskDetailView = {
    id: t.id,
    kind: t.kind,
    typeName: t.typeName,
    scheduledAt: t.scheduledAt.toISOString(),
    status: t.status,
    files: t.files.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes != null ? Number(f.sizeBytes) : null,
      createdAt: f.createdAt.toISOString(),
    })),
    mailDeliveries: t.mailDeliveries.map((mm) => {
      const m: MailView = {
        id: mm.id,
        step: mm.step,
        recipients: asEmails(mm.recipients),
        cc: asEmails(mm.cc), // 공개 헤더 — view 허용(D14)
        subject: mm.subject,
        status: mm.status,
        errorMessage: mm.errorMessage,
        sentAt: mm.sentAt ? mm.sentAt.toISOString() : null,
      };
      if (canSend) m.bcc = asEmails(mm.bcc); // D14: 은닉 envelope — :send 권한자 응답에만 필드 포함
      return m;
    }),
    timeline: t.events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId,
      note: e.note,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
  // :send 권한자에게만 prefill 재료를 노출(D8). 단계별 {to,cc,bcc} + 주소록 이름 enrich.
  if (canSend) {
    view.effectiveRecipients = await buildEffectiveRecipients(t.kind, t.defaultRecipients);
  }
  return view;
}
