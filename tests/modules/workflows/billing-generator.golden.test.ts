import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

// config repo는 mock(골든 config.json 주입). storage는 실제(tmp STORAGE_ROOT).
vi.mock("@/modules/workflows/repositories/billing", () => ({
  findBillingConfigByYear: vi.fn(),
  findRoundDatesByYear: vi.fn(async () => []),
}));

import * as repo from "@/modules/workflows/repositories/billing";
import { billingGenerator } from "@/modules/workflows/services/billing-generator";

const r = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const GOLDEN = path.join(__dirname, "../../golden/billing");
const ROOT = path.join(os.tmpdir(), "ops-hub-billing-golden");

// 공백·요소 사이 개행 정규화 후 비교(spec §12 2층).
function normalize(xml: string): string {
  return xml.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
}

beforeAll(() => {
  // STORAGE_ROOT/Template/대금청구 에 골든 템플릿 복사.
  process.env.STORAGE_ROOT = ROOT;
  const tplDst = path.join(ROOT, "Template", "대금청구");
  fs.mkdirSync(tplDst, { recursive: true });
  const tplSrc = path.join(GOLDEN, "templates", "대금청구");
  for (const f of fs.readdirSync(tplSrc)) fs.copyFileSync(path.join(tplSrc, f), path.join(tplDst, f));
  const cfg = JSON.parse(fs.readFileSync(path.join(GOLDEN, "config.json"), "utf8"));
  r.findBillingConfigByYear.mockResolvedValue({
    ...cfg, contractAmount: BigInt(cfg.contractAmount), monthlyAmount: BigInt(cfg.monthlyAmount),
  });
});
afterAll(() => { delete process.env.STORAGE_ROOT; fs.rmSync(ROOT, { recursive: true, force: true }); });

describe("billing-generator 골든 (2층, 회귀 자동 감지)", () => {
  it("4종 section0.xml이 골든과 정규화 일치", async () => {
    const outDir = path.join(ROOT, "out", "workflows", "golden-task", ".gen");
    // config.json의 scheduledAt(골든 산출물을 만든 청구일)을 그대로 사용.
    const cfg = JSON.parse(fs.readFileSync(path.join(GOLDEN, "config.json"), "utf8"));
    const result = await billingGenerator.generate(
      { id: "golden-task", scheduledAt: new Date(cfg.scheduledAt) } as never,
      outDir,
    );
    expect(result.files).toHaveLength(4);
    const keys = ["gongmun", "gisung", "jumgum1", "jumgum2"] as const;
    for (let i = 0; i < keys.length; i++) {
      const abs = path.join(outDir, path.basename(result.files[i].path));
      const zip = await JSZip.loadAsync(fs.readFileSync(abs));
      const xml = await zip.file("Contents/section0.xml")!.async("text");
      const expected = fs.readFileSync(path.join(GOLDEN, "expected", "section0", `${keys[i]}.xml`), "utf8");
      expect(normalize(xml)).toBe(normalize(expected));
    }
  });
});
