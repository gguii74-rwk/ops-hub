import "server-only";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { WorkflowTask } from "@prisma/client";
import type { GeneratorPort, GeneratorResult } from "../types";
import { resolveTemplatePath } from "@/lib/storage";
import { computeBillingPeriod, toKstFields, getLastDayOfMonth } from "../billing/period";
import { escapeXml, formatAmount, fillGisungTable, pad2 } from "../billing/hwpx-helpers";
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
      const { zip, xml: rawXml } = await applyReplacements(resolveTemplatePath(`대금청구/${TEMPLATES.gisung}`), [
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
      const filled = fillGisungTable(rawXml, billingDD, round, amountStr, config.monthlyAmount, roundDateMap);
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
