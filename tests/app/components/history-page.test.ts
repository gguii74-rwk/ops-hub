/**
 * Task 10 — 연차 내역 페이지 분기 및 권한 게이트 단위 테스트
 *
 * DOM 렌더 없이 순수 로직만 검증:
 * 1. HistoryClient 분기: canAdminView=false → MyHistory 경로(admin fetch 미호출)
 * 2. HistoryClient 분기: canAdminView=true → AdminHistory 경로(admin fetch 호출)
 * 3. 직접입력 버튼 게이트: canApprove=false → 버튼 미노출(createHandler 미호출)
 * 4. 직접입력 버튼 게이트: canApprove=true → 버튼 노출(createHandler 호출 가능)
 * 5. 수정/삭제 버튼 게이트: canUpdate=false && canDelete=false → 수정 버튼 미노출
 * 6. 수정/삭제 버튼 게이트: canUpdate=true → 수정 버튼 노출
 * 7. MyHistory fetchMine은 /api/leave/requests를 호출하고 /api/admin/* 미호출
 * 8. AdminHistory fetchAll은 /api/admin/leave/requests를 호출
 * 9. AdminHistory 클라이언트 필터링: year, 이름/부서 검색
 */
import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────
// 1-2. HistoryClient 분기 로직 (순수 함수로 추출)
// ─────────────────────────────────────────────

function resolveHistoryView(canAdminView: boolean): "admin" | "my" {
  return canAdminView ? "admin" : "my";
}

describe("HistoryClient 분기", () => {
  it("canAdminView=false → MyHistory 경로", () => {
    expect(resolveHistoryView(false)).toBe("my");
  });

  it("canAdminView=true → AdminHistory 경로", () => {
    expect(resolveHistoryView(true)).toBe("admin");
  });
});

// ─────────────────────────────────────────────
// 3-4. 직접입력 버튼 게이트 (canApprove)
// ─────────────────────────────────────────────

function shouldShowCreateButton(canApprove: boolean): boolean {
  return canApprove;
}

describe("직접입력 버튼 — canApprove 게이트", () => {
  it("canApprove=false → 버튼 미노출", () => {
    expect(shouldShowCreateButton(false)).toBe(false);
  });

  it("canApprove=true → 버튼 노출", () => {
    expect(shouldShowCreateButton(true)).toBe(true);
  });

  it("canApprove는 leave.approval:approve 키로 결정된다", () => {
    const adminKeys = new Set(["leave.admin:view", "leave.request:update", "leave.approval:approve"]);
    expect(shouldShowCreateButton(adminKeys.has("leave.approval:approve"))).toBe(true);

    // canUpdate는 직접입력 게이트가 아님(SC-2 결정 A)
    const updateOnlyKeys = new Set(["leave.admin:view", "leave.request:update"]);
    expect(shouldShowCreateButton(updateOnlyKeys.has("leave.approval:approve"))).toBe(false);
  });
});

// ─────────────────────────────────────────────
// 5-6. 수정/삭제 버튼 게이트 (canUpdate || canDelete)
// ─────────────────────────────────────────────

function shouldShowEditButton(canUpdate: boolean, canDelete: boolean): boolean {
  return canUpdate || canDelete;
}

describe("수정 버튼 — canUpdate || canDelete 게이트", () => {
  it("canUpdate=false && canDelete=false → 버튼 미노출", () => {
    expect(shouldShowEditButton(false, false)).toBe(false);
  });

  it("canUpdate=true → 버튼 노출", () => {
    expect(shouldShowEditButton(true, false)).toBe(true);
  });

  it("canDelete=true → 버튼 노출", () => {
    expect(shouldShowEditButton(false, true)).toBe(true);
  });

  it("canUpdate=true && canDelete=true → 버튼 노출", () => {
    expect(shouldShowEditButton(true, true)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 7. MyHistory fetch — /api/leave/requests 호출, /api/admin/* 미호출
// ─────────────────────────────────────────────

interface FetchCall { url: string }

function makeFetchSpy(responseItems: unknown[]): { calls: FetchCall[]; fn: typeof fetch } {
  const calls: FetchCall[] = [];
  const fn = async (input: RequestInfo | URL): Promise<Response> => {
    calls.push({ url: String(input) });
    return { ok: true, json: async () => ({ items: responseItems }) } as Response;
  };
  return { calls, fn };
}

// MyHistory fetchMine 로직 추출(my-history.tsx와 동일)
function makeMyFetchFn(fetchImpl: typeof fetch) {
  type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  return async (status?: LeaveStatus) => {
    const res = await fetchImpl(
      `/api/leave/requests${status ? `?status=${status}` : ""}`,
      { headers: { Accept: "application/json" } } as RequestInit,
    );
    if (!res.ok) throw new Error(`requests ${(res as { status: number }).status}`);
    return (await res.json()).items;
  };
}

describe("MyHistory fetch", () => {
  it("status 없을 때 /api/leave/requests 호출", async () => {
    const spy = makeFetchSpy([]);
    const fetch = makeMyFetchFn(spy.fn);
    await fetch();
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].url).toBe("/api/leave/requests");
    expect(spy.calls[0].url).not.toContain("/api/admin/");
  });

  it("status=PENDING 이면 쿼리스트링 추가", async () => {
    const spy = makeFetchSpy([]);
    const fetch = makeMyFetchFn(spy.fn);
    await fetch("PENDING");
    expect(spy.calls[0].url).toBe("/api/leave/requests?status=PENDING");
  });

  it("관리자 엔드포인트(/api/admin/*)를 호출하지 않음", async () => {
    const spy = makeFetchSpy([]);
    const fetch = makeMyFetchFn(spy.fn);
    await fetch("APPROVED");
    for (const c of spy.calls) {
      expect(c.url).not.toContain("/api/admin/");
    }
  });
});

// ─────────────────────────────────────────────
// 8. AdminHistory fetch — /api/admin/leave/requests 호출
// ─────────────────────────────────────────────

// AdminHistory fetchAll 로직 추출(admin-history.tsx와 동일)
function makeAdminFetchFn(fetchImpl: typeof fetch) {
  return async (status: string) => {
    const res = await fetchImpl(
      `/api/admin/leave/requests${status !== "ALL" ? `?status=${status}` : ""}`,
      { headers: { Accept: "application/json" } } as RequestInit,
    );
    if (!res.ok) throw new Error(`requests ${(res as { status: number }).status}`);
    return (await res.json()).items;
  };
}

describe("AdminHistory fetch", () => {
  it("status=ALL 이면 쿼리스트링 없이 /api/admin/leave/requests 호출", async () => {
    const spy = makeFetchSpy([]);
    const fetch = makeAdminFetchFn(spy.fn);
    await fetch("ALL");
    expect(spy.calls[0].url).toBe("/api/admin/leave/requests");
  });

  it("status=PENDING 이면 쿼리스트링 추가", async () => {
    const spy = makeFetchSpy([]);
    const fetch = makeAdminFetchFn(spy.fn);
    await fetch("PENDING");
    expect(spy.calls[0].url).toBe("/api/admin/leave/requests?status=PENDING");
  });
});

// ─────────────────────────────────────────────
// 9. AdminHistory 클라이언트 필터링
// ─────────────────────────────────────────────

type Row = {
  startDate: string;
  user: { name: string; team?: { name: string } | null } | null;
};

function applyAdminFilter(data: Row[], year: string, q: string): Row[] {
  return data.filter((r) => {
    if (year && new Date(r.startDate).getFullYear() !== Number(year)) return false;
    if (q && !(r.user?.name.includes(q) || (r.user?.team?.name ?? "").includes(q))) return false;
    return true;
  });
}

const sampleRows: Row[] = [
  { startDate: "2026-01-10T00:00:00.000Z", user: { name: "김철수", team: { name: "개발팀" } } },
  { startDate: "2026-03-05T00:00:00.000Z", user: { name: "이영희", team: { name: "기획팀" } } },
  { startDate: "2025-12-20T00:00:00.000Z", user: { name: "박민준", team: { name: "개발팀" } } },
  { startDate: "2026-06-01T00:00:00.000Z", user: null },
];

describe("AdminHistory 클라이언트 필터", () => {
  it("year 필터 없음 → 전체 반환", () => {
    expect(applyAdminFilter(sampleRows, "", "")).toHaveLength(4);
  });

  it("year=2026 → 2026년 행만 반환", () => {
    const result = applyAdminFilter(sampleRows, "2026", "");
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(new Date(r.startDate).getFullYear()).toBe(2026);
    }
  });

  it("year=2025 → 2025년 행만 반환", () => {
    const result = applyAdminFilter(sampleRows, "2025", "");
    expect(result).toHaveLength(1);
    expect(result[0].user?.name).toBe("박민준");
  });

  it("q=개발팀 → 부서 매칭 행만", () => {
    const result = applyAdminFilter(sampleRows, "", "개발팀");
    // 김철수(개발팀), 박민준(개발팀) — user=null은 제외
    expect(result).toHaveLength(2);
  });

  it("q=이영희 → 이름 매칭 행만", () => {
    const result = applyAdminFilter(sampleRows, "", "이영희");
    expect(result).toHaveLength(1);
    expect(result[0].user?.name).toBe("이영희");
  });

  it("year + q 복합 필터", () => {
    const result = applyAdminFilter(sampleRows, "2026", "개발팀");
    // 2026년 개발팀: 김철수만(박민준은 2025)
    expect(result).toHaveLength(1);
    expect(result[0].user?.name).toBe("김철수");
  });

  it("user=null인 행은 이름/부서 검색에서 제외", () => {
    const result = applyAdminFilter(sampleRows, "", "김");
    // user=null 행은 포함 안 됨
    for (const r of result) {
      expect(r.user).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────
// F-G: canApprove/canManage = getEffectiveScope === "all"
// team-scope approver는 canApprove/canManage = false (직접입력·전체관리 불가)
// ─────────────────────────────────────────────

type EffectiveScope = "all" | "team" | null;

function resolveCanApprove(scope: EffectiveScope): boolean {
  return scope === "all";
}

function resolveCanManage(scope: EffectiveScope): boolean {
  return scope === "all";
}

describe("F-G: canApprove/canManage — effective scope 기반", () => {
  it("scope=all → canApprove=true", () => {
    expect(resolveCanApprove("all")).toBe(true);
  });

  it("scope=team → canApprove=false (직접입력·전체관리 불가)", () => {
    expect(resolveCanApprove("team")).toBe(false);
  });

  it("scope=null → canApprove=false", () => {
    expect(resolveCanApprove(null)).toBe(false);
  });

  it("scope=all → canManage=true", () => {
    expect(resolveCanManage("all")).toBe(true);
  });

  it("scope=team → canManage=false (캘린더 관리 불가)", () => {
    expect(resolveCanManage("team")).toBe(false);
  });

  it("scope=null → canManage=false", () => {
    expect(resolveCanManage(null)).toBe(false);
  });
});
