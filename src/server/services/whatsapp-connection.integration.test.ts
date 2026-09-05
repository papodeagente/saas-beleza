import { randomBytes } from "node:crypto";
import { generateAccountCode } from "@/lib/account-code";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";

/**
 * Um número de WhatsApp atende uma conta só.
 *
 * Duas contas apontando para a mesma instância recebem o MESMO webhook: a
 * mensagem da cliente é gravada duas vezes e cada atendente passa a enxergar
 * as conversas da outra. Aconteceu nesta base — duas contas com o mesmo token
 * e o mesmo número, 3.300 mensagens espelhadas — e nada no banco impedia.
 */

const uazapi = vi.hoisted(() => ({ getStatus: vi.fn() }));
vi.mock("@/server/whatsapp/uazapi-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/whatsapp/uazapi-client")>();
  return { ...real, ...uazapi };
});

const { saveConnection } = await import("./whatsapp-connection-service");

const SUFFIX = "vitest-conexao";
const TOKEN = `tok-${randomBytes(6).toString("hex")}`;
let orgA = 0;
let orgB = 0;
const ctx = (organizationId: number): TenantContext =>
  ({ organizationId, userId: 1, role: "owner" }) as TenantContext;

beforeAll(async () => {
  const criar = async (nome: string, slug: string) => {
    const [row] = await db
      .insert(s.organizations)
      .values({ publicId: generateAccountCode(), name: nome, slug })
      .returning({ id: s.organizations.id });
    return row.id;
  };
  orgA = await criar(`Studio A ${SUFFIX}`, `a-${SUFFIX}`);
  orgB = await criar(`Studio B ${SUFFIX}`, `b-${SUFFIX}`);
  uazapi.getStatus.mockResolvedValue({
    connected: true,
    status: "connected",
    instanceId: "inst-compartilhada",
    instanceName: "Studio",
    phoneNumber: "5511999990000",
    profileName: "Studio",
  });
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, id));
  }
  await db.delete(s.organizations).where(like(s.organizations.slug, `%-${SUFFIX}`));
  await pool.end();
});

describe("conectar WhatsApp", () => {
  it("aceita a primeira conta que conecta o número", async () => {
    const view = await saveConnection(ctx(orgA), {
      baseUrl: "https://free.uazapi.com",
      instanceToken: TOKEN,
    });
    expect(view.status).toBe("connected");
  });

  it("recusa a segunda conta e diz onde o número está preso", async () => {
    await expect(
      saveConnection(ctx(orgB), { baseUrl: "https://free.uazapi.com", instanceToken: TOKEN }),
    ).rejects.toThrow(/já está conectado na conta Studio A/);

    // A recusa não pode deixar rastro: meia conexão gravada faria a tela de
    // WhatsApp da conta B mostrar um aparelho que não é dela.
    const sobrou = await db
      .select()
      .from(s.whatsappConnections)
      .where(eq(s.whatsappConnections.organizationId, orgB));
    expect(sobrou).toHaveLength(0);
  });

  it("reconhece a mesma instância mesmo com token novo", async () => {
    // Trocar o token no painel da uazapi não transforma o aparelho em outro:
    // a comparação é pela identidade da instância.
    await expect(
      saveConnection(ctx(orgB), {
        baseUrl: "https://free.uazapi.com",
        instanceToken: `tok-${randomBytes(6).toString("hex")}`,
      }),
    ).rejects.toThrow(/já está conectado na conta Studio A/);
  });

  it("libera o número quando a outra conta desconecta", async () => {
    // É assim que uma clínica leva o próprio aparelho embora ao trocar de
    // conta: conexão desligada não segura o número de ninguém.
    await db
      .update(s.whatsappConnections)
      .set({ active: false })
      .where(eq(s.whatsappConnections.organizationId, orgA));

    const view = await saveConnection(ctx(orgB), {
      baseUrl: "https://free.uazapi.com",
      instanceToken: TOKEN,
    });
    expect(view.status).toBe("connected");
  });
});
