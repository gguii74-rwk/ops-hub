export interface GoogleRawEvent {
  id: string;
  summary: string | null;
  description: string | null;
  start: { date?: string; dateTime?: string } | null;
  end: { date?: string; dateTime?: string } | null;
}

// lib-local 정규화 타입(module 타입에 의존하지 않음 — boundaries).
export interface NormalizedGoogleEvent {
  id: string;
  summary: string | null;
  description: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
}

function parseEdge(edge: { date?: string; dateTime?: string } | null): { date: Date; allDay: boolean } {
  if (edge?.date) {
    // all-day: 'YYYY-MM-DD'를 KST 자정으로 해석(고정 +09:00).
    return { date: new Date(`${edge.date}T00:00:00+09:00`), allDay: true };
  }
  if (edge?.dateTime) {
    return { date: new Date(edge.dateTime), allDay: false };
  }
  throw new Error("google event edge has neither date nor dateTime");
}

export function normalizeGoogleEvent(ev: GoogleRawEvent): NormalizedGoogleEvent {
  const start = parseEdge(ev.start);
  const end = parseEdge(ev.end);
  return {
    id: ev.id,
    summary: ev.summary,
    description: ev.description,
    start: start.date,
    end: end.date, // Google all-day end.date는 이미 배타(다음날) → 반열림 종료로 그대로 사용
    allDay: start.allDay,
  };
}

// 이벤트별 격리 정규화 — start/end가 불완전한 한 건(취소·id-only 등)이 parseEdge throw로 소스 전체
// 새로고침을 실패시키지 않게 한다(적대적 리뷰). 실패 건은 건너뛰고 개수만 돌려준다(호출부가 서버 로그로 집계).
export function normalizeGoogleEvents(raw: GoogleRawEvent[]): { events: NormalizedGoogleEvent[]; skipped: number } {
  const events: NormalizedGoogleEvent[] = [];
  let skipped = 0;
  for (const ev of raw) {
    try {
      events.push(normalizeGoogleEvent(ev));
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

// 페이지네이션: nextPageToken이 소진될 때까지 모든 페이지를 누적한다(단일 페이지만 읽고 이후를 버리면 조용히 누락 — 적대적 리뷰).
export async function collectAllPages(
  fetchPage: (pageToken?: string) => Promise<{ items: GoogleRawEvent[]; nextPageToken?: string }>,
): Promise<GoogleRawEvent[]> {
  const all: GoogleRawEvent[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    all.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}
