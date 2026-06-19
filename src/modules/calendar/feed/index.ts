import type { CalendarSourceProvider, CalEvent, FeedContext, FeedResponse, NormalizedRange, RawEvent, SourceStatus, ViewKey } from "../types";
import { VIEW_SOURCES } from "../views";
import { applyDedup } from "../dedup";
import { maskEvent } from "../masking";

export async function buildFeed(
  view: ViewKey,
  range: NormalizedRange,
  ctx: FeedContext,
  providers: Record<string, CalendarSourceProvider>,
): Promise<FeedResponse> {
  const selected = VIEW_SOURCES[view]
    .map((key) => providers[key])
    .filter((p): p is CalendarSourceProvider => Boolean(p));

  const settled = await Promise.allSettled(selected.map((p) => p.fetchEvents(range, ctx)));

  const raw: RawEvent[] = [];
  const statuses: SourceStatus[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      raw.push(...r.value.events);
      statuses.push(...r.value.statuses);
    } else {
      statuses.push({
        key: selected[i].key,
        state: "failed",
        lastFetchedAt: null,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  const deduped = applyDedup(raw);
  // 비-admin 뷰는 내부 휴가와 중복인 외부 이벤트를 접는다(비파괴 — 원본은 admin 뷰에서 노출).
  const folded = view === "admin" ? deduped : deduped.filter((e) => e.dedupStatus !== "DUPLICATE_OF_INTERNAL");
  // 잠정(미승인) 일정은 본인·admin에게만 노출 — 타인에겐 '마스킹'이 아니라 아예 제외(미승인 휴가가 실제 부재로 보이지 않게, Finding 3).
  const canSeeTentative = ctx.isOwner || ctx.permissionKeys.has("calendar.admin:view");
  let visible = folded.filter((e) => !e.tentative || canSeeTentative || e.userId === ctx.userId);
  // personal 뷰는 본인 소유 이벤트 + 공휴일만(팀/타인 데이터는 work/leave 뷰 전용). 소스 목록과 무관한 하드 게이트 —
  // 마스킹이 아니라 '제외'라 타인 userId·시각이 응답에 남지 않는다(적대적 리뷰 Finding 2).
  if (view === "personal") {
    visible = visible.filter((e) => e.userId === ctx.userId || e.kind === "HOLIDAY");
  }
  const events: CalEvent[] = visible.map((e) => maskEvent(e, ctx));

  // 클라이언트向 출처 오류는 일반 메시지로만 — 원본 예외는 서버 로그에만(민감정보 유출 방지, 적대적 리뷰 #7).
  const sources: SourceStatus[] = statuses.map((s) => {
    if (s.state === "ok") return s;
    if (s.error) console.error(`[calendar] source ${s.key} ${s.state}:`, s.error);
    return { ...s, error: s.state === "failed" ? "일정을 불러오지 못했습니다." : "최신 동기화에 실패해 이전 데이터를 표시합니다." };
  });
  const staleSources = sources.filter((s) => s.state === "stale").map((s) => s.key);
  const failedSources = sources.filter((s) => s.state === "failed").map((s) => s.key);

  return { events, sources, staleSources, failedSources };
}
