import { createHmac } from "node:crypto";

// calId → ownerUserId. 명시적 owner-map(calId→이메일)이 있을 때만 그 이메일의 userId로 귀속, 없으면 null(공유/팀).
// Phase 3 기본은 owner-map이 비어 있어 전부 null(team) — dedup/personal-google 비활성. map을 채우면 코드 변경 없이 활성화(§10).
export function resolveGoogleOwnerId(
  calId: string,
  ownerEmailByCalId: Record<string, string>,
  userIdByEmail: Record<string, string>,
): string | null {
  const email = ownerEmailByCalId[calId];
  if (!email) return null;
  return userIdByEmail[email] ?? null;
}

// Google 소스의 CalendarSource.key를 만든다. key는 feed 응답(sourceKey·이벤트 id·sources·stale/failed)에
// 실려 UI에 노출되므로 calId(개인 캘린더면 이메일)를 내장하면 안 된다(§9). 실제 calId는 externalId에만 보관한다.
// HMAC(server secret) 사용 — 무염 해시는 calId가 이메일(저엔트로피)이면 알려진 목록을 해싱해 역매핑 가능하다(적대적 리뷰).
// secret을 모르면 calId→key를 재현할 수 없고, 같은 secret이면 결정적이라 재시드 upsert(where: { key })가 멱등하다.
export function googleSourceKey(calId: string, secret: string): string {
  if (!secret) throw new Error("googleSourceKey: secret이 필요합니다 — 무염 결정적 해시(calId 역산 가능)로의 폴백 차단");
  return `google:${createHmac("sha256", secret).update(calId).digest("hex").slice(0, 12)}`;
}

export interface ExistingGoogleSource {
  id: string;
  externalId: string | null;
}

export interface GoogleSourceUpsert {
  existingId: string | null; // externalId 매칭 기존 행이 있으면 그 id(in-place update), 없으면 null(create)
  calId: string;
  key: string;
  ownerUserId: string | null;
}

export interface GoogleSourcePlan {
  upserts: GoogleSourceUpsert[];
  deactivateIds: string[]; // 설정에서 빠진 calId의 기존 행 — PAUSED로 비활성화
}

// 설정된 calIds + 기존 행 → 시드가 적용할 조정 계획. 식별은 **externalId(=calId, 안정)** 기준이라
// secret이 회전해도 같은 calId는 기존 행을 in-place로 재키잉한다(key-기준 upsert의 중복 ACTIVE 생성 차단 — 적대적 리뷰).
export function planGoogleSources(
  calIds: string[],
  existing: ExistingGoogleSource[],
  secret: string,
  ownerEmailByCalId: Record<string, string>,
  userIdByEmail: Record<string, string>,
): GoogleSourcePlan {
  const idByExternalId = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId as string, e.id]));
  const configured = new Set(calIds);
  const upserts: GoogleSourceUpsert[] = calIds.map((calId) => ({
    existingId: idByExternalId.get(calId) ?? null,
    calId,
    key: googleSourceKey(calId, secret),
    ownerUserId: resolveGoogleOwnerId(calId, ownerEmailByCalId, userIdByEmail),
  }));
  const deactivateIds = existing.filter((e) => e.externalId && !configured.has(e.externalId)).map((e) => e.id);
  return { upserts, deactivateIds };
}
