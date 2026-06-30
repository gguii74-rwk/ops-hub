import "server-only";
import path from "node:path";

// DB에 저장 가능한 storage-relative 경로의 1세그먼트 prefix만 허용(D2). keys/ 등은 이 계층 밖.
const ALLOWED_PREFIXES = ["Template", "out"] as const;
type AllowedPrefix = (typeof ALLOWED_PREFIXES)[number];

// STORAGE_ROOT(절대경로). 미설정·상대경로면 throw(fail-closed, spec §4.5).
// path.resolve로 정규화해 끝 구분자(/srv/storage/·D:\storage\)를 제거한다(R6-1) — 정규화하지 않으면
// `root + path.sep` 포함 검사가 깨져(`/srv/storage//`) 정상 하위 경로도 root 이탈로 오판된다.
export function getStorageRoot(): string {
  const root = process.env.STORAGE_ROOT;
  if (!root || !path.isAbsolute(root)) {
    throw new Error("STORAGE_ROOT가 설정되지 않았거나 절대경로가 아닙니다.");
  }
  return path.resolve(root);
}

export function getTemplateRoot(): string {
  return path.join(getStorageRoot(), "Template");
}

export function getOutputRoot(): string {
  return path.join(getStorageRoot(), "out");
}

// STRICT(F4·I4): "Template/…" 또는 "out/…" 상대 POSIX 경로만 → 절대경로.
// 절대·드라이브·.. 포함·prefix 불일치·root 이탈은 전부 throw(통과 경로 없음).
export function resolveStoragePath(stored: string): string {
  const root = getStorageRoot();
  if (path.isAbsolute(stored) || /^[A-Za-z]:/.test(stored)) {
    throw new Error(`저장 경로는 절대경로일 수 없습니다: ${stored}`);
  }
  // Windows 백슬래시를 슬래시로 정규화한 뒤 세그먼트 분리.
  const segments = stored.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    throw new Error(`경로에 ..를 포함할 수 없습니다: ${stored}`);
  }
  if (!ALLOWED_PREFIXES.includes(segments[0] as AllowedPrefix)) {
    throw new Error(`허용되지 않은 경로 prefix: ${stored}`);
  }
  const resolved = path.resolve(root, segments.join("/"));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`경로가 STORAGE_ROOT를 벗어납니다: ${stored}`);
  }
  return resolved;
}

export function resolveTemplatePath(rel: string): string {
  return resolveStoragePath(`Template/${rel}`);
}

export function resolveOutputPath(rel: string): string {
  return resolveStoragePath(`out/${rel}`);
}

// <root>/out 하위 절대경로 → "out/…" 상대(POSIX). 하위가 아니면 throw(절대경로를 DB에 저장하지 않음, I4).
// path.relative 기반 포함 검사: 드라이브 대소문자·구분자 차이에 강건하다(win32 I-2).
export function toStoredOutputPath(abs: string): string {
  const outRoot = getOutputRoot();
  const rel = path.relative(outRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`out 하위 경로가 아닙니다: ${abs}`);
  }
  return path.relative(getStorageRoot(), abs).split(path.sep).join("/");
}
