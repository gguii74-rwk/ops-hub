import "server-only";
import { google } from "googleapis";
import { collectAllPages, normalizeGoogleEvents, type GoogleRawEvent, type NormalizedGoogleEvent } from "./map";

export interface GoogleCalendarClient {
  listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<NormalizedGoogleEvent[]>;
}

export function getGoogleCalendarClient(): GoogleCalendarClient {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const calendar = google.calendar({ version: "v3", auth });

  return {
    async listEvents(calendarId, timeMin, timeMax) {
      // nextPageToken 소진까지 루프 — 단일 페이지(maxResults)만 읽고 이후를 버리면 조용히 누락된다(적대적 리뷰).
      const raw = await collectAllPages(async (pageToken) => {
        const res = await calendar.events.list({
          calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
        });
        const items: GoogleRawEvent[] = (res.data.items ?? [])
          .filter((it) => it.id != null)
          .map((it) => ({
            id: it.id!, // filter above narrows out null/undefined
            summary: it.summary ?? null,
            description: it.description ?? null,
            start: it.start ? { date: it.start.date ?? undefined, dateTime: it.start.dateTime ?? undefined } : null,
            end: it.end ? { date: it.end.date ?? undefined, dateTime: it.end.dateTime ?? undefined } : null,
          }));
        return { items, nextPageToken: res.data.nextPageToken ?? undefined };
      });
      // 이벤트별 격리 정규화 — 형식 오류 한 건이 소스 전체를 실패시키지 않게 한다(적대적 리뷰). 건너뛴 건은 서버 로그에만.
      const { events, skipped } = normalizeGoogleEvents(raw);
      if (skipped > 0) console.warn(`[google] calendar ${calendarId}: ${skipped}건 형식 오류 이벤트 건너뜀`);
      return events;
    },
  };
}
