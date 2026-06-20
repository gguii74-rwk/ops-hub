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
