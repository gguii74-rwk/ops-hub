import "server-only";
import { google } from "googleapis";
import { collectAllPages, normalizeGoogleEvent, type GoogleRawEvent, type NormalizedGoogleEvent } from "./map";

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
        const items: GoogleRawEvent[] = (res.data.items ?? []).map((it) => ({
          id: it.id ?? "",
          summary: it.summary ?? null,
          description: it.description ?? null,
          start: it.start ? { date: it.start.date ?? undefined, dateTime: it.start.dateTime ?? undefined } : null,
          end: it.end ? { date: it.end.date ?? undefined, dateTime: it.end.dateTime ?? undefined } : null,
        }));
        return { items, nextPageToken: res.data.nextPageToken ?? undefined };
      });
      return raw.map(normalizeGoogleEvent);
    },
  };
}
