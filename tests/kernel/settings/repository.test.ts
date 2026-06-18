import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

// --- in-memory fake store ---
// vi.hoisted로 mock factory보다 먼저 초기화 (vitest hoisting 규칙)
const { store, audits, getClient } = vi.hoisted(() => {
  type Row = { key: string; value: unknown; updatedAt: Date };
  const store = new Map<string, Row>();
  const audits: any[] = [];
  let clock = 1;
  const stamp = () => new Date(2026, 0, 1, 0, 0, 0, clock++);

  function makeClient(table: Map<string, Row>, auditSink: any[]) {
    const settings = {
      findUnique: async ({ where: { key } }: any) => (table.has(key) ? { ...table.get(key)! } : null),
      findUniqueOrThrow: async ({ where: { key } }: any) => {
        if (!table.has(key)) throw new Error("not found");
        return { ...table.get(key)! };
      },
      create: async ({ data }: any) => {
        if (table.has(data.key)) {
          throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        }
        const row = { key: data.key, value: data.value, updatedAt: stamp() };
        table.set(data.key, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const row = table.get(where.key);
        if (!row || (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime())) {
          return { count: 0 };
        }
        row.value = data.value;
        row.updatedAt = stamp();
        return { count: 1 };
      },
      upsert: async ({ where: { key }, create, update }: any) => {
        const existing = table.get(key);
        const row = existing
          ? { ...existing, value: update.value, updatedAt: stamp() }
          : { key, value: create.value, updatedAt: stamp() };
        table.set(key, row);
        return { ...row };
      },
    };
    return {
      systemSetting: settings,
      auditLog: { create: async ({ data }: any) => (auditSink.push(data), data) },
    };
  }

  const getClient = () => makeClient(store, audits);
  return { store, audits, getClient };
});

vi.mock("@/lib/prisma", () => {
  const client: any = getClient();
  client.$transaction = async (fn: any) => fn(client);
  return { prisma: client };
});

import { readRaw, writeWithAudit } from "@/kernel/settings/repository";
import { SettingConcurrencyError } from "@/kernel/settings/registry";

const idRedact = (_b: unknown, a: unknown) => ({ after: a }) as any;

beforeEach(() => {
  store.clear();
  audits.length = 0;
});

describe("repository readRaw", () => {
  it("없으면 null, 있으면 value+updatedAt", async () => {
    expect(await readRaw("integrations.smtp.host")).toBeNull();
    await writeWithAudit({ key: "integrations.smtp.host", value: "mail", expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    const row = await readRaw("integrations.smtp.host");
    expect(row?.value).toBe("mail");
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe("writeWithAudit concurrency", () => {
  it("expectedUpdatedAt=null: 최초 생성 성공 + audit 1건", async () => {
    const { updatedAt } = await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    expect(updatedAt).toBeInstanceOf(Date);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: "SystemSetting", entityId: "k.a.b", action: "settings.update", actorId: "u1" });
  });

  it("expectedUpdatedAt=null인데 이미 존재: SettingConcurrencyError + audit 미기록", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    audits.length = 0;
    await expect(
      writeWithAudit({ key: "k.a.b", value: 2, expectedUpdatedAt: null, actorId: "u2", redact: idRedact }),
    ).rejects.toBeInstanceOf(SettingConcurrencyError);
    expect(audits).toHaveLength(0);
  });

  it("expectedUpdatedAt=Date 일치: update 성공", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    const cur = await readRaw("k.a.b");
    const { updatedAt } = await writeWithAudit({ key: "k.a.b", value: 2, expectedUpdatedAt: cur!.updatedAt, actorId: "u1", redact: idRedact });
    expect(updatedAt.getTime()).toBeGreaterThan(cur!.updatedAt.getTime());
    expect((await readRaw("k.a.b"))!.value).toBe(2);
  });

  it("expectedUpdatedAt=Date 불일치: SettingConcurrencyError", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    await expect(
      writeWithAudit({ key: "k.a.b", value: 2, expectedUpdatedAt: new Date(1999, 0, 1), actorId: "u1", redact: idRedact }),
    ).rejects.toBeInstanceOf(SettingConcurrencyError);
  });

  it("expectedUpdatedAt=undefined: last-write-wins upsert", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, actorId: "u1", redact: idRedact });
    await writeWithAudit({ key: "k.a.b", value: 9, actorId: "u1", redact: idRedact });
    expect((await readRaw("k.a.b"))!.value).toBe(9);
  });

  it("redact 결과가 audit.metadata로 기록", async () => {
    await writeWithAudit({ key: "k.a.b", value: "v2", expectedUpdatedAt: null, actorId: "u1", redact: (b, a) => ({ before: b ?? null, after: a }) as any });
    expect(audits[0].metadata).toEqual({ before: null, after: "v2" });
  });
});
