// 수신자 세트 공용 타입·파서(D3·D8). 순수 모듈 — 서버(repo·service)와 클라(모달·관리 페이지 타입)가 공유한다.
export interface RecipientFields { to: string[]; cc: string[]; bcc: string[] }
export type DefaultRecipientsMap = Record<string, RecipientFields>;

export interface RecipientEntry { email: string; name?: string }
export interface EffectiveRecipientFields { to: RecipientEntry[]; cc: RecipientEntry[]; bcc: RecipientEntry[] }
export type EffectiveRecipientsMap = Record<string, EffectiveRecipientFields>;

const toStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

// WorkflowType.defaultRecipients(Json) → 단계별 맵. flat legacy 배열·원시값은 null(fail-closed —
// preflight가 non-null legacy 0을 증명하지만, 파서도 오독 경로를 갖지 않는다).
export function parseDefaultRecipients(json: unknown): DefaultRecipientsMap | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const out: DefaultRecipientsMap = {};
  for (const [step, v] of Object.entries(json as Record<string, unknown>)) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const f = v as Record<string, unknown>;
    out[step] = { to: toStringArray(f.to), cc: toStringArray(f.cc), bcc: toStringArray(f.bcc) };
  }
  return out;
}

// 세트 저장 정규화(§3): trim → 빈 제거 → 소문자 → 순서보존 dedup. 주소록(email 소문자 저장, D2) 조인 매칭 일관.
export function normalizeStoredEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (e && !seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}
