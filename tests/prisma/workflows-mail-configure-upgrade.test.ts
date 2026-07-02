import { describe, it, expect } from "vitest";
import {
  applyWorkflowsMailConfigureUpgrade,
  WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG,
} from "../../prisma/migrate-helpers/workflows-mail-configure-upgrade";

function fakeDb(flagExists: boolean) {
  const upserts: Array<{ create: Record<string, unknown> }> = [];
  const created: Array<Record<string, unknown>> = [];
  const db = {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        flagExists && where.key === WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG ? { key: where.key } : null,
      create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), a.data),
    },
    rolePermission: {
      findMany: async () => [],
      upsert: async (a: { create: Record<string, unknown> }) => (upserts.push(a), {}),
    },
  };
  return { db: db as never, upserts, created };
}
const roleIds = new Map([["pm", "role-pm"]]);
const permIds = new Map([["workflows.mail:configure", "perm-mail-cfg"]]);

describe("applyWorkflowsMailConfigureUpgrade (D11 upgrade-once)", () => {
  it("pm에 workflows.mail:configure ALLOW(all)를 upsert하고 플래그 기록", async () => {
    const { db, upserts, created } = fakeDb(false);
    const out = await applyWorkflowsMailConfigureUpgrade(db, roleIds, permIds);
    expect(out.applied).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create).toMatchObject({ roleId: "role-pm", permissionId: "perm-mail-cfg", effect: "ALLOW", scope: "all" });
    expect(created[0].key).toBe(WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG);
  });
  it("플래그 존재 시 no-op(멱등)", async () => {
    const { db, upserts, created } = fakeDb(true);
    const out = await applyWorkflowsMailConfigureUpgrade(db, roleIds, permIds);
    expect(out.applied).toBe(false);
    expect(upserts).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
  it("pm 역할 미존재 → throw(fail-closed, 플래그 미설정 — 다음 seed 재시도)", async () => {
    const { db, created } = fakeDb(false);
    await expect(applyWorkflowsMailConfigureUpgrade(db, new Map(), permIds)).rejects.toThrow(/pm/);
    expect(created).toHaveLength(0);
  });
  it("권한 미존재 → throw(fail-closed)", async () => {
    const { db, created } = fakeDb(false);
    await expect(applyWorkflowsMailConfigureUpgrade(db, roleIds, new Map())).rejects.toThrow(/workflows\.mail:configure/);
    expect(created).toHaveLength(0);
  });
});
