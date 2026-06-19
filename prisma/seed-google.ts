import { createHash } from "node:crypto";

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
// 실려 UI에 노출되므로 calId(개인 캘린더면 이메일)를 내장하면 안 된다(§9 — 적대적 리뷰 5차). 실제 calId는
// externalId에만 보관한다. 해시라 결정적 → 재시드 upsert(where: { key })가 멱등하다.
export function googleSourceKey(calId: string): string {
  return `google:${createHash("sha256").update(calId).digest("hex").slice(0, 12)}`;
}
