# Task 02 — kernel/holidays 리더 + 공공데이터 sync

**Purpose:** `Holiday` 테이블을 day-calc 출처로 읽는 리더 + 공공데이터포털 특일정보 API에서 테이블로 동기화하는 sync. 부팅 시 현재+익년을 자동 적재(`instrumentation.ts`)해 연도 경과 시 내후년이 자동 채워지게 한다. leave는 calendar import 금지 → kernel/lib에 둔다.

## Files
- Create: `src/lib/integrations/holidays/index.ts` (공공데이터 특일정보 클라이언트)
- Create: `src/kernel/holidays/index.ts` (리더 + sync + ensure)
- Create: `src/instrumentation.ts` (부팅 시 ensureYearsSynced)
- Modify: `.env.example` (`DATA_GO_KR_SERVICE_KEY` 추가)
- Create: `tests/lib/integrations/holidays.test.ts`
- Create: `tests/kernel/holidays/index.test.ts`

## Prep
- spec §4.1, §7 / entrypoint §SC-6, §SC-8.
- 공공데이터포털 "한국천문연구원_특일 정보" `getRestDeInfo`: params `serviceKey`, `solYear`(YYYY), `solMonth`(MM), `_type=json`, `numOfRows`. 응답 `response.body.items.item`(배열 또는 단일), 각 `{ locdate: 20260101, dateName, isHoliday: "Y" }`. **`isHoliday==="Y"`만** 공휴일.
- Next 15+는 instrumentation 기본 활성(next.config 설정 불필요).

## Deps
- 01 (Holiday 모델·Prisma Client).

## Steps

### 1. .env.example
`.env.example`에 추가:
```
# 공공데이터포털 한국천문연구원 특일정보 API 인증키(공휴일 동기화)
DATA_GO_KR_SERVICE_KEY=""
```

### 2. 클라이언트 실패 테스트
`tests/lib/integrations/holidays.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchHolidays } from "@/lib/integrations/holidays";

const okJson = (items: unknown) => ({ ok: true, json: async () => ({ response: { body: { items } } }) });

beforeEach(() => { process.env.DATA_GO_KR_SERVICE_KEY = "test-key"; });
afterEach(() => { vi.restoreAllMocks(); });

describe("fetchHolidays", () => {
  it("isHoliday=Y만, locdate→YYYY-MM-DD, 중복 제거", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("solMonth=01")) return okJson({ item: [
        { locdate: 20260101, dateName: "신정", isHoliday: "Y" },
        { locdate: 20260102, dateName: "평일(테스트)", isHoliday: "N" },
      ] }) as Response;
      if (url.includes("solMonth=03")) return okJson({ item: { locdate: 20260301, dateName: "삼일절", isHoliday: "Y" } }) as Response; // 단일 객체
      return okJson("") as Response; // 빈 달
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchHolidays(2026);
    expect(res).toContainEqual({ date: "2026-01-01", name: "신정" });
    expect(res).toContainEqual({ date: "2026-03-01", name: "삼일절" });
    expect(res.find((h) => h.date === "2026-01-02")).toBeUndefined(); // isHoliday N 제외
    expect(fetchMock).toHaveBeenCalledTimes(12); // 월별 호출
  });

  it("키 없으면 throw", async () => {
    delete process.env.DATA_GO_KR_SERVICE_KEY;
    await expect(fetchHolidays(2026)).rejects.toThrow();
  });
});
```

```
npm test -- tests/lib/integrations/holidays   # expect FAIL
```

### 3. 클라이언트 구현
`src/lib/integrations/holidays/index.ts`:

```ts
const BASE = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

export interface RawHoliday { date: string; name: string; }
interface ApiItem { locdate: number | string; dateName: string; isHoliday: string; }

function locdateToKey(locdate: number | string): string {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

async function fetchMonth(year: number, month: number, key: string): Promise<RawHoliday[]> {
  const mm = String(month).padStart(2, "0");
  const url = `${BASE}?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${mm}&_type=json&numOfRows=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`특일정보 API ${res.status} (${year}-${mm})`);
  const json = (await res.json()) as { response?: { body?: { items?: unknown } } };
  const items = json.response?.body?.items;
  if (!items || items === "") return [];
  const raw = (items as { item?: ApiItem | ApiItem[] }).item;
  const list: ApiItem[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((i) => i.isHoliday === "Y").map((i) => ({ date: locdateToKey(i.locdate), name: i.dateName }));
}

/** 한 해 공휴일을 월별로 조회·병합(중복 date 제거). DATA_GO_KR_SERVICE_KEY 필요. */
export async function fetchHolidays(year: number): Promise<RawHoliday[]> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) throw new Error("DATA_GO_KR_SERVICE_KEY 미설정");
  const all: RawHoliday[] = [];
  for (let m = 1; m <= 12; m++) all.push(...(await fetchMonth(year, m, key)));
  const seen = new Map<string, string>();
  for (const h of all) if (!seen.has(h.date)) seen.set(h.date, h.name);
  return [...seen].map(([date, name]) => ({ date, name }));
}
```

```
npm test -- tests/lib/integrations/holidays   # expect PASS
```

### 4. 리더·sync 실패 테스트
`tests/kernel/holidays/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const count = vi.fn();
const upsert = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { holiday: { findMany, count, upsert } } }));
const fetchHolidays = vi.fn();
vi.mock("@/lib/integrations/holidays", () => ({ fetchHolidays }));

import { getHolidaysInRange, ensureYearsSynced, syncHolidaysForYear } from "@/kernel/holidays";

beforeEach(() => vi.clearAllMocks());

describe("getHolidaysInRange", () => {
  it("범위 공휴일을 YYYY-MM-DD Set으로", async () => {
    findMany.mockResolvedValue([{ date: new Date("2026-08-15T00:00:00.000Z") }]);
    const set = await getHolidaysInRange(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T00:00:00Z"));
    expect(set.has("2026-08-15")).toBe(true);
  });
});

describe("syncHolidaysForYear", () => {
  it("fetch 결과를 upsert", async () => {
    fetchHolidays.mockResolvedValue([{ date: "2026-01-01", name: "신정" }]);
    const n = await syncHolidaysForYear(2026);
    expect(n).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: new Date("2026-01-01T00:00:00.000Z") },
    }));
  });
});

describe("ensureYearsSynced", () => {
  it("미적재(count=0)면 sync, 적재됐으면 skip", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
    fetchHolidays.mockResolvedValue([{ date: "2027-01-01", name: "신정" }]);
    await ensureYearsSynced([2027, 2026]);
    expect(fetchHolidays).toHaveBeenCalledTimes(1);
    expect(fetchHolidays).toHaveBeenCalledWith(2027);
  });
  it("sync 실패는 throw하지 않음(로그 후 진행)", async () => {
    count.mockResolvedValue(0);
    fetchHolidays.mockRejectedValue(new Error("API down"));
    await expect(ensureYearsSynced([2027])).resolves.toBeUndefined();
  });
});
```

```
npm test -- tests/kernel/holidays   # expect FAIL
```

### 5. 리더·sync 구현
`src/kernel/holidays/index.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { fetchHolidays } from "@/lib/integrations/holidays";

/** [start, end] 범위의 공휴일을 "YYYY-MM-DD"(UTC) Set으로. 빈 결과 정상. */
export async function getHolidaysInRange(start: Date, end: Date): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
}

/** 공공데이터 특일정보에서 해당 연도 공휴일을 가져와 upsert. 반환=건수. */
export async function syncHolidaysForYear(year: number): Promise<number> {
  const holidays = await fetchHolidays(year);
  for (const h of holidays) {
    const date = new Date(`${h.date}T00:00:00.000Z`);
    await prisma.holiday.upsert({ where: { date }, update: { name: h.name, year }, create: { date, name: h.name, year } });
  }
  return holidays.length;
}

/** 미적재(count===0) 연도만 sync. 실패는 로그 후 진행(장애 격리). */
export async function ensureYearsSynced(years: number[]): Promise<void> {
  for (const year of years) {
    try {
      if ((await prisma.holiday.count({ where: { year } })) === 0) {
        const n = await syncHolidaysForYear(year);
        console.log(`[holidays] ${year}년 공휴일 ${n}건 동기화`);
      }
    } catch (e) {
      console.error(`[holidays] ${year}년 동기화 실패(무시):`, e);
    }
  }
}
```

```
npm test -- tests/kernel/holidays   # expect PASS
```

### 6. 부팅 훅
`src/instrumentation.ts`:

```ts
// 서버 부팅 시 현재+익년 공휴일을 보장한다. 재시작마다 도므로 연도 경과 시 내후년 자동 적재.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureYearsSynced } = await import("@/kernel/holidays");
    const y = new Date().getFullYear();
    await ensureYearsSynced([y, y + 1]);
  } catch (e) {
    console.error("[instrumentation] 공휴일 부팅 동기화 실패(무시):", e);
  }
}
```

### 7. 커밋
```
git add src/lib/integrations/holidays src/kernel/holidays src/instrumentation.ts .env.example tests/lib/integrations/holidays.test.ts tests/kernel/holidays
git commit -m "feat(leave): 공공데이터 특일정보 sync·kernel/holidays 리더·부팅 자동 적재"
```

## Acceptance Criteria
- `npm test -- tests/lib/integrations/holidays tests/kernel/holidays` → PASS.
- `npm run typecheck` / `npm run lint` → 그린.
- (DB+키 있을 때) 앱 부팅 시 `[holidays] N건 동기화` 로그, `Holiday` 테이블에 현재+익년 행.

## Cautions
- **Don't `getHolidaysInRange`에서 sync하지 말 것.** Reason: day-calc는 테이블만 읽어 결정적이어야 한다. sync는 부팅/admin/backstop 별도 경로.
- **Don't sync 실패를 throw로 전파하지 말 것.** Reason: 공휴일 API 장애가 부팅·연차 신청을 막으면 안 된다 — 로그 후 진행(미적재 구간은 주말만 제외 폴백).
- **Don't 키를 `getDate()`(로컬 TZ)로 만들지 말 것.** Reason: `@db.Date`는 UTC 자정 — `toISOString().slice(0,10)` / `T00:00:00.000Z` 파싱으로 통일.
- **Don't instrumentation에서 정적 import로 prisma를 끌어오지 말 것.** Reason: edge 런타임 로드 회피 — `NEXT_RUNTIME==="nodejs"` 가드 + 동적 import.
