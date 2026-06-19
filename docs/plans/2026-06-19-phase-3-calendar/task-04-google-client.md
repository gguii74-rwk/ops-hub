# Task 04 — Google 클라이언트 (lib) + 정규화

service account 자격증명으로 Google Calendar 이벤트를 가져오는 lib 클라이언트와, Google 이벤트(all-day/timed)를 절대시각으로 정규화하는 **순수 함수**. boundaries상 **lib는 module 타입을 import 못 한다** → lib는 lib-local `NormalizedGoogleEvent`까지만 만들고, `RawEvent` 매핑은 module 쪽(Task 06)에서 한다.

## Files

- Create: `src/lib/integrations/google/map.ts` (순수 정규화 — 테스트 대상)
- Create: `src/lib/integrations/google/calendar.ts` (service account 클라이언트)
- Create: `src/lib/integrations/google/index.ts` (re-export)
- Test: `tests/lib/integrations/google/map.test.ts`

## Prep

- Spec §3(Google), §11(all-day/KST). 엔트리포인트 §Shared Contracts Google 블록.
- `googleapis`는 이미 설치됨(package.json). 새 의존성 없음.
- secret: `GOOGLE_APPLICATION_CREDENTIALS`(service account JSON 파일 경로) — `src/modules/integrations/status.ts`가 이미 이 키를 점검한다.

## Deps

01 (없이도 무방 — lib-local 타입만 사용). 표기상 01.

## Steps

### 1. 정규화 테스트 먼저 (FAIL 확인)

`tests/lib/integrations/google/map.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { normalizeGoogleEvent, collectAllPages } from "@/lib/integrations/google/map";

describe("normalizeGoogleEvent", () => {
  it("all-day: date(시작) ~ date(종료, 배타) → 반열림 KST 경계, allDay true", () => {
    const n = normalizeGoogleEvent({
      id: "g1",
      summary: "여름 휴가",
      description: null,
      start: { date: "2026-06-19" },
      end: { date: "2026-06-20" }, // Google all-day 종료는 배타(다음날)
    });
    expect(n.allDay).toBe(true);
    expect(n.start.toISOString()).toBe("2026-06-18T15:00:00.000Z"); // 06-19 00:00 KST
    expect(n.end.toISOString()).toBe("2026-06-19T15:00:00.000Z"); // 06-20 00:00 KST
    expect(n.summary).toBe("여름 휴가");
  });

  it("timed: dateTime → 절대시각, allDay false", () => {
    const n = normalizeGoogleEvent({
      id: "g2",
      summary: "회의",
      description: "주간",
      start: { dateTime: "2026-06-19T10:00:00+09:00" },
      end: { dateTime: "2026-06-19T11:00:00+09:00" },
    });
    expect(n.allDay).toBe(false);
    expect(n.start.toISOString()).toBe("2026-06-19T01:00:00.000Z");
    expect(n.end.toISOString()).toBe("2026-06-19T02:00:00.000Z");
  });

  it("summary 없으면 null 보존(제목 결정은 module이)", () => {
    const n = normalizeGoogleEvent({ id: "g3", summary: null, description: null, start: { date: "2026-06-19" }, end: { date: "2026-06-20" } });
    expect(n.summary).toBeNull();
    expect(n.id).toBe("g3");
  });
});

describe("collectAllPages", () => {
  const ev = (id: string): any => ({ id, summary: id, description: null, start: { date: "2026-06-19" }, end: { date: "2026-06-20" } });

  it("nextPageToken을 따라 모든 페이지 누적(2500건 초과 누락 방지)", async () => {
    const pages: Record<string, { items: any[]; nextPageToken?: string }> = {
      "": { items: [ev("a"), ev("b")], nextPageToken: "p2" },
      p2: { items: [ev("c")], nextPageToken: "p3" },
      p3: { items: [ev("d")] }, // 토큰 없음 → 종료
    };
    const calls: (string | undefined)[] = [];
    const out = await collectAllPages(async (t) => {
      calls.push(t);
      return pages[t ?? ""];
    });
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(calls).toEqual([undefined, "p2", "p3"]);
  });

  it("단일 페이지(토큰 없음) → 한 번만 호출", async () => {
    const fetchPage = vi.fn(async () => ({ items: [ev("only")] }));
    const out = await collectAllPages(fetchPage);
    expect(out.map((e) => e.id)).toEqual(["only"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
```

실행(FAIL): `npm test -- tests/lib/integrations/google/map.test.ts`

### 2. 정규화 구현 (PASS 확인)

`src/lib/integrations/google/map.ts`:

```ts
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
```

실행(PASS): `npm test -- tests/lib/integrations/google/map.test.ts`

### 3. 클라이언트 구현 (typecheck로 검증 — googleapis 호출은 단위 테스트 대상 아님)

`src/lib/integrations/google/calendar.ts`:

```ts
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
```

`src/lib/integrations/google/index.ts`:

```ts
export { getGoogleCalendarClient, type GoogleCalendarClient } from "./calendar";
export { normalizeGoogleEvent, type GoogleRawEvent, type NormalizedGoogleEvent } from "./map";
```

### 4. commit

```
git add src/lib/integrations/google tests/lib/integrations/google
git commit -m "google: add service-account calendar client + pure event normalization"
```

## Acceptance Criteria

- `npm test -- tests/lib/integrations/google/map.test.ts` → PASS(정규화 + `collectAllPages` 다중 페이지 누적).
- `npm run typecheck` → 에러 없음(googleapis 타입 포함).
- `npm run lint` → boundaries OK(lib는 lib만 import — module 타입 import 없음).

## Cautions

- **mapGoogleEvent가 `RawEvent`(module 타입)를 반환하게 만들지 말 것.** 이유: `boundaries/element-types`상 lib는 module을 import할 수 없다. lib는 `NormalizedGoogleEvent`까지만, `RawEvent` 변환은 Task 06 provider에서.
- **lib에서 `@/modules/calendar/time` 등 module 유틸 import 금지.** 이유: 같은 경계 규칙. all-day 파싱은 `+09:00` 리터럴로 lib 안에서 자립한다.
- **Google all-day `end.date`를 +1일 하지 말 것.** 이유: Google은 종료일을 이미 배타(다음날)로 준다. 그대로 반열림 종료로 쓴다.
- **`events.list`를 단일 호출로 끝내지 말 것.** 이유: 6주 창에 2500건(특히 `singleEvents:true`로 반복 일정 펼침) 초과 시 `nextPageToken` 이후 페이지가 조용히 누락되고 `failed` 신호도 없다(적대적 리뷰). `collectAllPages`로 토큰 소진까지 누적한다.
