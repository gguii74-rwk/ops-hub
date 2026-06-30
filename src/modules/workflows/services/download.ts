import "server-only";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { ForbiddenError } from "@/kernel/access";
import { resolveStoragePath } from "@/lib/storage";
import { KIND_RESOURCE } from "../policy";
import { findGeneratedFileForDownload, findTaskForDownload } from "../repositories";
import type { WorkflowKind } from "@prisma/client";

interface DownloadCtx { isOwner: boolean; permissionKeys: Set<string>; }

function canView(ctx: DownloadCtx, kind: WorkflowKind): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${KIND_RESOURCE[kind]}:view`);
}

export interface FileDownload { bytes: Uint8Array; filename: string; mimeType: string; }

export async function getFileForDownload(ctx: DownloadCtx, taskId: string, fileId: string): Promise<FileDownload | null> {
  const f = await findGeneratedFileForDownload(fileId);
  if (!f || f.taskId !== taskId) return null; // raw path 금지 — id로만 조회(D13)
  if (!canView(ctx, f.kind)) throw new ForbiddenError("열람 권한이 없습니다.");
  let abs: string;
  try {
    abs = resolveStoragePath(f.path); // strict — 절대경로/.. row면 throw → 다운로드 거부(F4)
  } catch {
    return null;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return {
    bytes: new Uint8Array(fs.readFileSync(abs)),
    filename: f.displayName,
    mimeType: f.mimeType ?? "application/octet-stream",
  };
}

export interface ZipDownload { bytes: Uint8Array; filename: string; }

export async function getDirectoryZip(ctx: DownloadCtx, taskId: string): Promise<ZipDownload | null> {
  const t = await findTaskForDownload(taskId);
  if (!t || !t.outputPath) return null;
  if (!canView(ctx, t.kind)) throw new ForbiddenError("열람 권한이 없습니다.");
  let absDir: string;
  try {
    absDir = resolveStoragePath(t.outputPath); // strict(F4)
  } catch {
    return null;
  }
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return null;
  const zip = new JSZip();
  for (const name of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    if (fs.statSync(abs).isFile()) zip.file(name, fs.readFileSync(abs));
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return { bytes: new Uint8Array(buf), filename: `${taskId}.zip` };
}
