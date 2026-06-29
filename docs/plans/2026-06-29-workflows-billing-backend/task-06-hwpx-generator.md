# Task 06 — GeneratorPort 계약 변경 + HWPX 4종 생성기 + 골든

**Purpose:** `GeneratorPort.generate`에 `outDir`를 추가하고(SC-4), day-sync `billing-hwpx-generator.ts`를 `GeneratorPort` 구현체로 포팅한다. XML 이스케이프(D9)·누계 BigInt(J4)·storage 경로로 조정하고, 순수 XML 헬퍼를 분리해 1층 단위 + 2층 골든으로 검증한다(spec §7·§12, 본체).

## Files

- **Modify:** `src/modules/workflows/types.ts` — `GeneratorPort.generate(task, outDir)`(§Shared Contracts SC-4)
- **Create:** `src/modules/workflows/billing/hwpx-helpers.ts` — 순수 XML/포맷 헬퍼
- **Create:** `src/modules/workflows/services/billing-generator.ts` — `GeneratorPort` 구현(HWPX 4종)
- **Create (test):** `tests/modules/workflows/billing-hwpx-helpers.test.ts` (1층)
- **Create (test):** `tests/modules/workflows/billing-generator.golden.test.ts` (2층)
- **Create (fixture, Phase 0):** `tests/golden/billing/templates/대금청구/*.hwpx`(템플릿 4종), `tests/golden/billing/expected/section0/*.xml`(정답 4종), `tests/golden/billing/config.json`(입력)

## Prep

- 읽기: spec §7(전체)·§12 Phase 0·2층, entrypoint §Shared Contracts SC-1·SC-2·SC-4·SC-7.
- 포팅 원본: day-sync `src/lib/billing-hwpx-generator.ts`(341줄) — 치환 목록·`fillGisungTable`·`fillEmptyCell`·`clearCellText`를 **정확히** 옮기되 아래 3개만 조정: ① 치환 값에 XML escape(D9), ② 누계 BigInt(J4), ③ 경로를 `STORAGE_ROOT/out·Template` 기준(D2·D3).
- 의존: task-01(`resolveTemplatePath`/`resolveOutputPath`), task-05(`computeBillingPeriod`/`toKstFields`/`getLastDayOfMonth`), task-03(`findBillingConfigByYear`/`findRoundDatesByYear`).
- **Phase 0 골든 캡처(코드 작성 전 1회)**: day-sync `Template/대금청구/*.hwpx` 4종을 `tests/golden/billing/templates/대금청구/`로 복사. day-sync `output/billing-*/`의 정답 산출물 4종을 ZIP 해제해 `Contents/section0.xml`을 `tests/golden/billing/expected/section0/<key>.xml`로 박제. 그 산출물을 만든 입력(projectName·계약번호·금액·`*Kor`·회차 제출일)을 `config.json`으로 기록. day-sync 재실행 불필요(파일 이미 존재).

## Deps

01, 03, 05. (generate가 task-03의 `findBillingConfigByYear`/`findRoundDatesByYear`를 import하므로 typecheck에 03 선행 필요. 골든 테스트는 repo를 mock하지만 빌드/타입체크에 03 머지가 앞서야 한다.)

## TDD steps

### 1. GeneratorPort 계약 변경 — `src/modules/workflows/types.ts`

```ts
export interface GeneratorPort {
  kind: WorkflowKind;
  generate(task: WorkflowTask, outDir: string): Promise<GeneratorResult>;
}
```

(`GeneratorResult`는 변경 없음. `services/generator.ts`의 `recordGeneratedFiles`도 변경 없음 — `GeneratorResult.files`를 그대로 받는다.)

### 2. 1층 실패 테스트 — `tests/modules/workflows/billing-hwpx-helpers.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { escapeXml, formatAmount, formatAmountBig, fillEmptyCell, clearCellText, fillGisungTable } from "@/modules/workflows/billing/hwpx-helpers";

describe("escapeXml (D9)", () => {
  it("& < > \" ' 를 엔티티로", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
  it("& 를 먼저 치환(이중 이스케이프 방지)", () => {
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("formatAmount / formatAmountBig", () => {
  it("number 콤마 포맷", () => { expect(formatAmount(139590000)).toBe("139,590,000"); });
  it("bigint 콤마 포맷(누계 J4)", () => { expect(formatAmountBig(418770000n)).toBe("418,770,000"); });
});

const cell = (col: number, row: number) =>
  `<hp:tc><hp:subList><hp:p><hp:run charPrIDRef="6"/></hp:p></hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/></hp:tc>`;

describe("fillEmptyCell / clearCellText", () => {
  it("빈 self-closing run을 텍스트 run으로 치환", () => {
    const out = fillEmptyCell(cell(6, 7), 6, 7, "418,770,000");
    expect(out).toContain('<hp:run charPrIDRef="6"><hp:t>418,770,000</hp:t></hp:run>');
  });
  it("marker 없으면 원본 유지", () => {
    expect(fillEmptyCell(cell(1, 5), 9, 9, "x")).toBe(cell(1, 5));
  });
  it("clearCellText: <hp:t> 비움", () => {
    const xml = `<hp:tc><hp:subList><hp:p><hp:run><hp:t>old</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="2" rowAddr="6"/></hp:tc>`;
    expect(clearCellText(xml, 2, 6)).toContain("<hp:t></hp:t>");
  });
});

describe("fillGisungTable (행·열·누계 BigInt)", () => {
  it("round=1이면 2회차 행(rowAddr=6) 텍스트 clear, 1회차 날짜 치환", () => {
    const xml = "02월 10일" + cell(1, 6) + cell(2, 6) + cell(4, 6) + cell(6, 6);
    const out = fillGisungTable(xml, "15", 1, "139,590,000", 139590000n, {});
    expect(out).toContain("02월 15일"); // 1회차 제출일 치환(폴백 DD=15)
  });
  it("round=3이면 3회차 누계 = monthlyAmount*3을 BigInt로(rowAddr=7)", () => {
    const xml = "02월 10일03월 10일" + cell(1, 7) + cell(2, 7) + cell(4, 7) + cell(6, 7);
    const out = fillGisungTable(xml, "10", 3, "139,590,000", 139590000n, {});
    expect(out).toContain("<hp:t>418,770,000</hp:t>"); // 139,590,000 * 3
  });
});
```

### 3. 1층 구현 — `src/modules/workflows/billing/hwpx-helpers.ts`

```ts
// 순수 XML/포맷 헬퍼(fs/Prisma 미의존, 1층 단위 테스트 대상). day-sync billing-hwpx-generator.ts 포팅.

export function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// 치환 *값*에만 적용(D9). & 를 먼저(이중 이스케이프 방지). split/replace 마커 자체엔 적용 안 함.
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatAmount(amount: number): string { return amount.toLocaleString("en-US"); }
export function formatAmountBig(amount: bigint): string { return amount.toLocaleString("en-US"); }

// colAddr/rowAddr로 셀을 찾아 빈 <hp:run charPrIDRef="6"/> 를 텍스트 run으로 치환.
export function fillEmptyCell(xml: string, colAddr: number, rowAddr: number, text: string): string {
  const marker = `colAddr="${colAddr}" rowAddr="${rowAddr}"`;
  const markerIdx = xml.indexOf(marker);
  if (markerIdx === -1) return xml;
  const beforeMarker = xml.substring(0, markerIdx);
  const tcStart = beforeMarker.lastIndexOf("<hp:tc");
  if (tcStart === -1) return xml;
  const cellContent = xml.substring(tcStart, markerIdx);
  const selfClosingRun = '<hp:run charPrIDRef="6"/>';
  const selfClosingRunIdx = cellContent.indexOf(selfClosingRun);
  if (selfClosingRunIdx === -1) return xml;
  const absoluteIdx = tcStart + selfClosingRunIdx;
  const replacement = `<hp:run charPrIDRef="6"><hp:t>${text}</hp:t></hp:run>`;
  return xml.substring(0, absoluteIdx) + replacement + xml.substring(absoluteIdx + selfClosingRun.length);
}

// 특정 셀의 <hp:t> 텍스트를 빈 문자열로 교체.
export function clearCellText(xml: string, colAddr: number, rowAddr: number): string {
  const marker = `colAddr="${colAddr}" rowAddr="${rowAddr}"`;
  const markerIdx = xml.indexOf(marker);
  if (markerIdx === -1) return xml;
  const tcStart = xml.lastIndexOf("<hp:tc", markerIdx);
  if (tcStart === -1) return xml;
  const tcEnd = xml.indexOf("</hp:tc>", markerIdx);
  if (tcEnd === -1) return xml;
  const cellXml = xml.substring(tcStart, tcEnd);
  const newCellXml = cellXml.replace(/<hp:t>[^<]*<\/hp:t>/g, "<hp:t></hp:t>");
  return xml.substring(0, tcStart) + newCellXml + xml.substring(tcEnd);
}

// roundDateMap[round]의 submitDate(instant)에서 KST DD(2자리). 없으면 청구일 fallbackDD(J2).
const KST_OFFSET_MS = 540 * 60_000;
function ddOfRound(round: number, roundDateMap: Record<number, Date>, fallbackDD: string): string {
  const d = roundDateMap[round];
  if (!d) return fallbackDD;
  const s = new Date(new Date(d).getTime() + KST_OFFSET_MS);
  return pad2(s.getUTCDate());
}

// 누계는 monthlyAmount(bigint) * i 로 BigInt 계산(J4). amountStr는 월 청구금액 문자열(이미 포맷됨).
export function fillGisungTable(
  xml: string, billingDD: string, round: number, amountStr: string, monthlyAmount: bigint,
  roundDateMap: Record<number, Date> = {},
): string {
  let result = xml;
  const dd1 = ddOfRound(1, roundDateMap, billingDD);
  result = result.split("02월 10일").join(`02월 ${dd1}일`);

  if (round >= 2) {
    const dd2 = ddOfRound(2, roundDateMap, billingDD);
    result = result.split("03월 10일").join(`03월 ${dd2}일`);
  } else {
    result = clearCellText(result, 1, 6);
    result = clearCellText(result, 2, 6);
    result = clearCellText(result, 4, 6);
    result = clearCellText(result, 6, 6);
  }

  for (let i = 3; i <= round; i++) {
    const rowAddr = i + 4;
    const submitMonth = pad2((i % 12) + 1);
    const ddI = ddOfRound(i, roundDateMap, billingDD);
    const submitDate = `${submitMonth}월 ${ddI}일`;
    const cumulative = formatAmountBig(monthlyAmount * BigInt(i)); // J4: BigInt 곱, 포맷 직전 문자열화
    result = fillEmptyCell(result, 1, rowAddr, submitDate);
    result = fillEmptyCell(result, 2, rowAddr, amountStr);
    result = fillEmptyCell(result, 4, rowAddr, amountStr);
    result = fillEmptyCell(result, 6, rowAddr, cumulative);
  }
  return result;
}
```

(`ddOfRound`/`KST_OFFSET_MS`는 위에 정의돼 있어 `fillGisungTable`이 호출한다. day-sync `getRoundDD`는 로컬 TZ DD라 KST로 교체했다 — J2.)

### 4. 1층 실행 → PASS

```bash
npm test -- tests/modules/workflows/billing-hwpx-helpers.test.ts
```

### 5. 생성기 구현 — `src/modules/workflows/services/billing-generator.ts`

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { WorkflowTask } from "@prisma/client";
import type { GeneratorPort, GeneratorResult } from "../types";
import { resolveTemplatePath } from "@/lib/storage";
import { computeBillingPeriod, toKstFields, getLastDayOfMonth } from "../billing/period";
import { escapeXml, formatAmount, formatAmountBig, fillGisungTable, pad2 } from "../billing/hwpx-helpers";
import { findBillingConfigByYear, findRoundDatesByYear } from "../repositories/billing";

const HWPX_MIME = "application/octet-stream";

const TEMPLATES = {
  gongmun: "(공문)안전신문고 시스템 유지관리 사업(02월).hwpx",
  gisung: "붙임파일_기성계(02월).hwpx",
  jumgum1: "수탁 업체 개인정보 관리 실태 점검표(02월).hwpx",
  jumgum2: "정보화용역사업 보안관리 월별 점검표(26년 안전신문고 시스템 유지관리사업)(02월).hwpx",
} as const;

function outputFileNames(prevMM: string, projectYY: string): Record<keyof typeof TEMPLATES, string> {
  return {
    gongmun: `(공문)안전신문고 시스템 유지관리 사업(${prevMM}월).hwpx`,
    gisung: `붙임파일_기성계(${prevMM}월).hwpx`,
    jumgum1: `수탁 업체 개인정보 관리 실태 점검표(${prevMM}월).hwpx`,
    jumgum2: `정보화용역사업 보안관리 월별 점검표(${projectYY}년 안전신문고 시스템 유지관리사업)(${prevMM}월).hwpx`,
  };
}

interface Replacement { from: string | RegExp; to: string; }

async function applyReplacements(absTemplate: string, replacements: Replacement[]): Promise<{ zip: JSZip; xml: string }> {
  const buf = fs.readFileSync(absTemplate);
  const zip = await JSZip.loadAsync(buf);
  const cf = zip.file("Contents/section0.xml");
  if (!cf) throw new Error(`section0.xml을 찾을 수 없습니다: ${absTemplate}`);
  let xml = await cf.async("text");
  for (const { from, to } of replacements) {
    xml = typeof from === "string" ? xml.split(from).join(to) : xml.replace(from, to);
  }
  return { zip, xml };
}

async function writeHwpx(zip: JSZip, xml: string, absOut: string): Promise<number> {
  zip.file("Contents/section0.xml", xml);
  const out = await zip.generateAsync({ type: "nodebuffer" });
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, out);
  return out.length;
}

export const billingGenerator: GeneratorPort = {
  kind: "BILLING",
  async generate(task: WorkflowTask, outDir: string): Promise<GeneratorResult> {
    const { projectYear, round, billingDate } = computeBillingPeriod(task.scheduledAt);
    const config = await findBillingConfigByYear(projectYear);
    if (!config) throw new Error(`${projectYear}년 대금청구 설정이 없습니다.`); // fail-closed(spec §11)

    const roundDates = await findRoundDatesByYear(projectYear);
    const roundDateMap: Record<number, Date> = {};
    for (const rd of roundDates) roundDateMap[rd.round] = rd.submitDate;

    const b = toKstFields(billingDate);
    const billingYear = b.year;
    const billingMM = pad2(b.month);
    const billingDD = pad2(b.day);
    const billingM = String(b.month);
    const prevYear = projectYear;
    const prevMM = pad2(round);
    const prevLastDayStr = pad2(getLastDayOfMonth(prevYear, round));
    const projectYY = String(projectYear).slice(2);

    const projectName = escapeXml(config.projectName);
    const contractNumber = escapeXml(config.contractNumber);
    const contractAmountKor = escapeXml(config.contractAmountKor);
    const monthlyAmountKor = escapeXml(config.monthlyAmountKor);
    const contractAmountStr = formatAmount(Number(config.contractAmount));
    const amountStr = formatAmount(Number(config.monthlyAmount));

    const names = outputFileNames(prevMM, projectYY);
    const storedDir = `out/workflows/${task.id}`;
    const files: GeneratorResult["files"] = [];

    // 1. 공문
    {
      const { zip, xml } = await applyReplacements(resolveTemplatePath(`대금청구/${TEMPLATES.gongmun}`), [
        { from: "제 2026-03-10-01 호", to: `제 ${billingYear}-${billingMM}-${billingDD}-01 호` },
        { from: "2026년 03월 10일", to: `${billingYear}년 ${billingMM}월 ${billingDD}일` },
        { from: "2026년 안전신문고 시스템 유지관리 사업", to: `${projectYear}년 ${projectName}` },
        { from: "R25TA0125611600", to: contractNumber },
        { from: "2026년 01월 01일 ~ 2026년 12월 31일", to: `${projectYear}년 01월 01일 ~ ${projectYear}년 12월 31일` },
        { from: "금1,675,080,000원", to: `금${contractAmountStr}원` },
        { from: "(금일십육억칠천오백팔만원정)", to: `(${contractAmountKor})` },
        {
          from: '금139,590</hp:t></hp:run><hp:run charPrIDRef="12"><hp:t>,000원 (금일억삼천구백오십구만원정)',
          to: `금${amountStr}원 (${monthlyAmountKor})</hp:t></hp:run><hp:run charPrIDRef="12"><hp:t>`,
        },
        { from: "금139,590,000원", to: `금${amountStr}원` },
        { from: "2026.02월분", to: `${prevYear}.${prevMM}월분` },
        { from: "2026년 02월 수행한", to: `${prevYear}년 ${prevMM}월 수행한` },
        { from: "2026년 02월 – 1개월 분", to: `${prevYear}년 ${prevMM}월 – 1개월 분` },
      ]);
      const size = await writeHwpx(zip, xml, path.join(outDir, names.gongmun));
      files.push({ path: `${storedDir}/${names.gongmun}`, displayName: names.gongmun, mimeType: HWPX_MIME, sizeBytes: size });
    }

    // 2. 기성계 — 텍스트 치환 후 회차 테이블 채움
    {
      const { zip, xml } = await applyReplacements(resolveTemplatePath(`대금청구/${TEMPLATES.gisung}`), [
        { from: "2026년 안전신문고 시스템 유지관리 사업", to: `${projectYear}년 ${projectName}` },
        { from: "2026. 01. 01. ~ 2026. 12. 31.", to: `${projectYear}. 01. 01. ~ ${projectYear}. 12. 31.` },
        { from: "금일십육억칠천오백팔만원정(￦1,675,080,000)", to: `${contractAmountKor}(￦${contractAmountStr})` },
        { from: "일금 ￦1,675,080,000 원정 [VAT 포함]", to: `일금 ￦${contractAmountStr} 원정 [VAT 포함]` },
        { from: "1,675,080,000", to: contractAmountStr },
        { from: "금일억삼천구백오십구만원정(￦139,590,000)", to: `${monthlyAmountKor}(￦${amountStr})` },
        { from: "일금 ￦139,590,000 원정 [VAT 포함]", to: `일금 ￦${amountStr} 원정 [VAT 포함]` },
        { from: "139,590,000", to: amountStr },
        { from: "기성부분 검사조서(2026년)", to: `기성부분 검사조서(${projectYear}년)` },
        { from: "2026년 02월 01일 ~ 2026년 02월 28일", to: `${prevYear}년 ${prevMM}월 01일 ~ ${prevYear}년 ${prevMM}월 ${prevLastDayStr}일` },
        { from: "2026년 03월 10일", to: `${billingYear}년 ${billingMM}월 ${billingDD}일` },
        { from: /2026\. 02\. 01\. ~ 2026\. 02\. 28\./g, to: `${prevYear}. ${prevMM}. 01. ~ ${prevYear}. ${prevMM}. ${prevLastDayStr}.` },
        { from: /2026\. 03\. 10\./g, to: `${billingYear}. ${billingMM}. ${billingDD}.` },
      ]);
      const filled = fillGisungTable(xml, billingDD, round, amountStr, config.monthlyAmount, roundDateMap);
      const size = await writeHwpx(zip, filled, path.join(outDir, names.gisung));
      files.push({ path: `${storedDir}/${names.gisung}`, displayName: names.gisung, mimeType: HWPX_MIME, sizeBytes: size });
    }

    // 3. 점검표1
    {
      const { zip, xml } = await applyReplacements(resolveTemplatePath(`대금청구/${TEMPLATES.jumgum1}`), [
        { from: "’26.03.10.", to: `’${projectYY}.${billingMM}.${billingDD}.` },
        { from: "’26.1.1.~12.31.", to: `’${projectYY}.1.1.~12.31.` },
        {
          from: "2026년 안전신문고 시스템",
          to: `${projectYear}년 ${escapeXml(config.projectName.replace(" 유지관리 사업", "").replace("안전신문고 시스템 유지관리 사업", "안전신문고 시스템"))}`,
        },
      ]);
      const size = await writeHwpx(zip, xml, path.join(outDir, names.jumgum1));
      files.push({ path: `${storedDir}/${names.jumgum1}`, displayName: names.jumgum1, mimeType: HWPX_MIME, sizeBytes: size });
    }

    // 4. 점검표2
    {
      const { zip, xml } = await applyReplacements(resolveTemplatePath(`대금청구/${TEMPLATES.jumgum2}`), [
        { from: "2026.3.10.", to: `${billingYear}.${billingM}.${billingDD}.` },
        { from: "2026년 안전신문고 시스템 유지관리 사업", to: `${projectYear}년 ${projectName}` },
        { from: "2026.1.1.~2026.12.31.", to: `${projectYear}.1.1.~${projectYear}.12.31.` },
      ]);
      const size = await writeHwpx(zip, xml, path.join(outDir, names.jumgum2));
      files.push({ path: `${storedDir}/${names.jumgum2}`, displayName: names.jumgum2, mimeType: HWPX_MIME, sizeBytes: size });
    }

    return { files };
  },
};
```

### 6. 2층 골든 테스트 — `tests/modules/workflows/billing-generator.golden.test.ts`

```ts
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
```

> **Phase 0 주의:** 골든 fixture(`templates/`, `expected/section0/`, `config.json`)가 없으면 이 테스트는 fixture 부재로 실패한다. fixture를 먼저 박제(Prep)한 뒤 generate를 맞춰간다. `config.json`은 `{ year, projectName, contractNumber, contractAmount, monthlyAmount, contractAmountKor, monthlyAmountKor, scheduledAt }` — `scheduledAt`은 골든 산출물을 만든 청구일(예: `"2026-03-10T01:00:00Z"` = KST 3/10 → 전월 2월 = round 2, projectYear 2026). `findBillingConfigByYear`는 `projectYear`로 조회되므로 `config.json.year`는 `projectYear`와 일치해야 한다.

### 7. 2층 실행 → PASS (필요 시 generate 치환을 골든에 맞춰 조정)

```bash
npm test -- tests/modules/workflows/billing-generator.golden.test.ts
```

### 8. commit

```bash
git add src/modules/workflows/types.ts src/modules/workflows/billing/hwpx-helpers.ts src/modules/workflows/services/billing-generator.ts tests/modules/workflows/billing-hwpx-helpers.test.ts tests/modules/workflows/billing-generator.golden.test.ts tests/golden/billing
git commit -m "feat(workflows): HWPX 4종 생성기(GeneratorPort, XML escape·누계 BigInt) + 골든"
```

## Acceptance Criteria

- 1층 `billing-hwpx-helpers.test.ts` + 2층 골든 전건 PASS.
- `npm run typecheck` / `npm run lint`(boundaries — generator는 `@/lib/storage`·자기 모듈만; calendar 미import) / `npm run build` 통과.
- 3층(수동, plan 범위 밖이나 기능 "완료" 전 필수): 생성물을 한컴에서 실제 열기(무성 실패 최종 확인) — spec §12.

## Cautions

- **Don't** `String.replace(from, to)`로 문자열 치환하지 말 것. Reason: `to`의 `$&`/`$1`이 치환 토큰으로 해석된다(금액·한글에 `$` 없더라도 방어). 문자열 마커는 `split(from).join(to)`, RegExp만 `replace`(day-sync 패턴).
- **Don't** 누계를 `Number(monthlyAmount) * i`로 계산하지 말 것. Reason: J4 결정 — BigInt 곱 후 포맷 직전에만 문자열화. `monthlyAmount(bigint) * BigInt(i)`.
- **Don't** escape를 split/replace 마커(`from`)에 적용하지 말 것. Reason: 마커는 템플릿 원문과 정확히 일치해야 매칭된다. escape는 삽입 텍스트(`to`)에만(D9).
- **Don't** day-sync처럼 `getMonth()`/`getFullYear()`로 전월을 계산하지 말 것. Reason: `computeBillingPeriod`(KST)·`toKstFields`만 사용(J2).
- **Don't** 출력 디렉터리를 `billing-{YYYYMM}/`로 만들지 말 것. Reason: D3 — 출력은 orchestrator가 준 `outDir`(임시)에 쓰고, `files[].path`는 `out/workflows/<taskId>/…`(taskId 기반).
- **Don't** 한글 템플릿 파일명을 ASCII로 치환하지 말 것. Reason: 골든 대조·한컴 열기를 위해 day-sync와 **동일 파일명** 유지.
