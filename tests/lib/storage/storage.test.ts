import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  getStorageRoot, getTemplateRoot, getOutputRoot,
  resolveStoragePath, resolveTemplatePath, resolveOutputPath, toStoredOutputPath,
} from "@/lib/storage";

const ROOT = path.join(os.tmpdir(), "ops-hub-storage-test");

describe("lib/storage strict resolver (F4·I4·D2·D13)", () => {
  beforeEach(() => { process.env.STORAGE_ROOT = ROOT; });
  afterEach(() => { delete process.env.STORAGE_ROOT; });

  it("STORAGE_ROOT 미설정이면 throw(fail-closed)", () => {
    delete process.env.STORAGE_ROOT;
    expect(() => getStorageRoot()).toThrow();
  });
  it("STORAGE_ROOT가 상대경로면 throw", () => {
    process.env.STORAGE_ROOT = "relative/dir";
    expect(() => getStorageRoot()).toThrow();
  });
  it("template/output root", () => {
    expect(getTemplateRoot()).toBe(path.join(ROOT, "Template"));
    expect(getOutputRoot()).toBe(path.join(ROOT, "out"));
  });
  it("out/… 상대 → 절대(root 하위)", () => {
    expect(resolveStoragePath("out/workflows/t1/a.hwpx")).toBe(path.resolve(ROOT, "out/workflows/t1/a.hwpx"));
  });
  it("Template/… 상대 → 절대", () => {
    expect(resolveStoragePath("Template/대금청구/x.hwpx")).toBe(path.resolve(ROOT, "Template/대금청구/x.hwpx"));
  });
  it("절대경로 거부", () => {
    expect(() => resolveStoragePath("/etc/passwd")).toThrow();
  });
  it("드라이브 경로 거부", () => {
    expect(() => resolveStoragePath("C:/Windows/x")).toThrow();
  });
  it(".. 포함 거부", () => {
    expect(() => resolveStoragePath("out/../../etc")).toThrow();
  });
  it("허용 안 된 prefix 거부", () => {
    expect(() => resolveStoragePath("keys/secret")).toThrow();
    expect(() => resolveStoragePath("foo/bar")).toThrow();
    expect(() => resolveStoragePath("")).toThrow();
  });
  it("resolveTemplatePath/resolveOutputPath는 strict 기반", () => {
    expect(resolveTemplatePath("대금청구/x")).toBe(path.resolve(ROOT, "Template/대금청구/x"));
    expect(resolveOutputPath("workflows/t1")).toBe(path.resolve(ROOT, "out/workflows/t1"));
    expect(() => resolveOutputPath("../../etc")).toThrow();
  });
  it("toStoredOutputPath: out 하위 절대 → out/… 상대(POSIX)", () => {
    const abs = path.resolve(ROOT, "out/workflows/t1/a.hwpx");
    expect(toStoredOutputPath(abs)).toBe("out/workflows/t1/a.hwpx");
  });
  it("toStoredOutputPath: out 밖이면 throw(I4)", () => {
    expect(() => toStoredOutputPath(path.resolve(ROOT, "Template/x"))).toThrow();
    expect(() => toStoredOutputPath(path.join(os.tmpdir(), "elsewhere"))).toThrow();
  });
  // I-1: win32에서 드라이브 상대 슬래시 경로(/out/foo)는 첫 세그먼트가 빈 문자열 → prefix 불일치로 throw.
  it("드라이브 상대 슬래시 경로 거부(I-1)", () => {
    expect(() => resolveStoragePath("/out/foo")).toThrow();
  });
  // M-2: resolveTemplatePath의 .. 통과 방지.
  it("resolveTemplatePath: .. 포함 거부(M-2)", () => {
    expect(() => resolveTemplatePath("../etc")).toThrow();
  });
});
