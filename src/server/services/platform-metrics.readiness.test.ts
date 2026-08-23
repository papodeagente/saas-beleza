import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { paymentProviders } from "@/db/schema";
import { getLaunchReadiness } from "./platform-metrics";

/**
 * O passo "Cobrança" do painel inicial, contra o Postgres real.
 *
 * Este teste existe por causa de um bug que ficou de pé por semanas sem dar erro
 * nenhum: a consulta contava provedor "ligado de verdade" por `credentials is
 * not null`, e NADA no produto escreve nessa coluna — quem salva provedor
 * (`saveProvider`, em services/hotmart.ts) guarda o segredo em
 * `webhook_token_hash`. O resultado era sempre zero, então o passo nunca ficava
 * verde nem com a Hotmart ligada e validando entrega. Um número que é sempre
 * zero não parece quebrado, parece pendente — e ninguém investiga uma pendência.
 *
 * A asserção é por DIFERENÇA porque a consulta é cross-tenant: ela enxerga
 * qualquer provedor que já exista no banco de desenvolvimento.
 */

const CANDIDATOS = ["manual", "stripe", "cakto", "pagarme", "asaas"] as const;

let kindLivre: (typeof CANDIDATOS)[number] | undefined;
let criadoId: number | undefined;

beforeAll(async () => {
  // `payment_providers.kind` é único: o teste precisa de um tipo que ninguém
  // esteja usando, senão a inserção esbarraria na configuração real.
  const usados = new Set(
    (await db.select({ kind: paymentProviders.kind }).from(paymentProviders)).map((r) => r.kind),
  );
  kindLivre = CANDIDATOS.find((kind) => !usados.has(kind));
});

afterAll(async () => {
  if (criadoId) await db.delete(paymentProviders).where(eq(paymentProviders.id, criadoId));
  await pool.end();
});

describe("estado inicial da plataforma", () => {
  it("conta como pronto o provedor ligado que guardou o segredo do webhook", async () => {
    expect(kindLivre, "todos os tipos de provedor já estão cadastrados").toBeDefined();

    const antes = await getLaunchReadiness();

    const [row] = await db
      .insert(paymentProviders)
      .values({
        kind: kindLivre!,
        name: "Provedor de teste (vitest)",
        enabled: true,
        // Exatamente o que `saveProvider` grava — e nada em `credentials`.
        webhookTokenHash: "hash-de-teste",
        webhookTokenHint: "••••este",
      })
      .returning({ id: paymentProviders.id });
    criadoId = row.id;

    const comSegredo = await getLaunchReadiness();
    expect(comSegredo.configuredProviders).toBe(antes.configuredProviders + 1);
    expect(comSegredo.liveProviders).toBe(antes.liveProviders + 1);

    // Ligado e sem segredo nenhum não cobra: a tela não pode ficar verde.
    await db
      .update(paymentProviders)
      .set({ webhookTokenHash: null, webhookTokenHint: null })
      .where(eq(paymentProviders.id, criadoId));

    const semSegredo = await getLaunchReadiness();
    expect(semSegredo.liveProviders).toBe(antes.liveProviders);
    expect(semSegredo.configuredProviders).toBe(antes.configuredProviders + 1);
  });
});
