import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { whatsappConnections, whatsappProfilePictures } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { type UazapiCredentials, getChatDetails } from "@/server/whatsapp/uazapi-client";

/**
 * Fotos de perfil do WhatsApp no Inbox.
 *
 * O caminho é sempre o mesmo: perguntar a ficha do contato à uazapi, baixar a
 * MINIATURA e guardar os bytes. Nunca o link — ele aponta para o CDN do
 * WhatsApp e expira, o que daria uma lista de avatares que funciona hoje e
 * some depois, sem erro nenhum para investigar.
 *
 * Três limites existem porque isto conversa com um serviço de terceiro que a
 * clínica inteira compartilha:
 *  - só busca de novo quando o registro está velho (TTL abaixo);
 *  - processa em série com um respiro entre chamadas;
 *  - qualquer falha é silenciosa e não invalida o que já estava guardado.
 */

/** Foto encontrada envelhece devagar: gente troca de foto, mas não toda hora. */
const TTL_ENCONTRADA_MS = 7 * 24 * 60 * 60 * 1000;
/** Sem foto envelhece mais rápido, para quem colocar uma aparecer em dias. */
const TTL_SEM_FOTO_MS = 3 * 24 * 60 * 60 * 1000;
/** Respiro entre chamadas. A uazapi é compartilhada por toda a clínica. */
const INTERVALO_MS = 150;
/**
 * Orçamento de tempo de UMA busca. O corte é por relógio e não só por
 * quantidade porque o que trava a tela é a espera, não o número de contatos:
 * uma clínica com trezentos grupos precisa ver progresso, não um botão girando
 * por dois minutos. O que sobra fica para o clique seguinte.
 */
const ORCAMENTO_MS = 25_000;
/** Teto de bytes por miniatura. Acima disso é resposta errada, não foto. */
const LIMITE_BYTES = 512 * 1024;

export type SyncResult = {
  buscadas: number;
  atualizadas: number;
  semFoto: number;
  falhas: number;
  /** Quantas ainda faltam depois desta rodada. */
  restantes: number;
};

function credenciais(row: { baseUrl: string; instanceToken: string }): UazapiCredentials {
  return { baseUrl: row.baseUrl, token: row.instanceToken };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Baixa a miniatura. Devolve nulo em qualquer resposta que não seja uma imagem
 * de tamanho plausível: um HTML de erro salvo como se fosse foto viraria avatar
 * quebrado que ninguém consegue diagnosticar depois.
 */
async function baixarMiniatura(url: string): Promise<{ mime: string; base64: string } | null> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) return null;

  const mime = resp.headers.get("content-type") ?? "";
  if (!mime.startsWith("image/")) return null;

  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length === 0 || bytes.length > LIMITE_BYTES) return null;

  return { mime, base64: bytes.toString("base64") };
}

async function gravar(
  organizationId: number,
  jid: string,
  foto: { mime: string; base64: string } | null,
) {
  const valores = {
    organizationId,
    jid,
    mime: foto?.mime ?? null,
    dataBase64: foto?.base64 ?? null,
    missing: foto === null,
    fetchedAt: new Date(),
  };
  await db
    .insert(whatsappProfilePictures)
    .values(valores)
    .onConflictDoUpdate({
      target: [whatsappProfilePictures.organizationId, whatsappProfilePictures.jid],
      set: {
        mime: valores.mime,
        dataBase64: valores.dataBase64,
        missing: valores.missing,
        fetchedAt: valores.fetchedAt,
      },
    });
}

/**
 * Quais JIDs desta organização precisam de foto agora.
 *
 * Vale para contato e para grupo: o grupo tem foto própria e ela é o que a
 * atendente reconhece na lista.
 */
async function jidsPendentes(organizationId: number, limite: number): Promise<string[]> {
  const { rows } = await db.execute<{ jid: string }>(sql`
    -- Conversa e grupo entram na mesma fila porque a foto é indexada por JID e
    -- os dois têm avatar. A ordem prioriza atividade recente: numa clínica com
    -- centenas de grupos, o que a atendente vê hoje vale mais que o resto.
    with alvos as (
      select c.remote_jid as jid, c.last_message_at as visto_em
      from conversations c
      where c.organization_id = ${organizationId} and c.remote_jid is not null
      union
      -- O grupo não guarda data da última mensagem; updated_at avança a cada
      -- sincronização e é o sinal de atividade mais próximo que existe aqui.
      -- (Sem crase neste comentário: ela fecharia o template literal.)
      select g.jid, g.updated_at
      from whatsapp_groups g
      where g.organization_id = ${organizationId}
    )
    select a.jid
    from alvos a
    left join whatsapp_profile_pictures p
      on p.organization_id = ${organizationId} and p.jid = a.jid
    where
      p.id is null
      or (p.missing = false and p.fetched_at < now() - ${`${TTL_ENCONTRADA_MS} milliseconds`}::interval)
      or (p.missing = true  and p.fetched_at < now() - ${`${TTL_SEM_FOTO_MS} milliseconds`}::interval)
    order by a.visto_em desc nulls last
    limit ${limite}
  `);
  return (rows as { jid: string }[]).map((r) => r.jid);
}

/**
 * Busca as fotos que estão faltando ou vencidas.
 *
 * `limite` existe porque uma clínica com milhares de conversas não pode
 * transformar um clique em milhares de chamadas à uazapi.
 */
export async function syncProfilePictures(
  ctx: TenantContext,
  limite = 400,
): Promise<SyncResult> {
  const resultado: SyncResult = {
    buscadas: 0,
    atualizadas: 0,
    semFoto: 0,
    falhas: 0,
    restantes: 0,
  };
  const prazo = Date.now() + ORCAMENTO_MS;

  const [conexao] = await db
    .select({ baseUrl: whatsappConnections.baseUrl, instanceToken: whatsappConnections.instanceToken })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.organizationId, ctx.organizationId),
        eq(whatsappConnections.status, "connected"),
        eq(whatsappConnections.active, true),
      ),
    )
    .limit(1);

  // Sem WhatsApp conectado não há de onde tirar foto. Não é erro: é o estado
  // normal de uma clínica que ainda não ligou o canal.
  if (!conexao?.baseUrl || !conexao.instanceToken) return resultado;

  const creds = credenciais(conexao);
  const jids = await jidsPendentes(ctx.organizationId, limite);

  for (const jid of jids) {
    // Para no prazo e devolve o que já conseguiu. Interromper com resultado
    // parcial é melhor que devolver tudo tarde demais para ser útil.
    if (Date.now() > prazo) break;
    resultado.buscadas += 1;
    try {
      const ficha = await getChatDetails(creds, jid);
      const foto = ficha?.imagePreviewUrl ? await baixarMiniatura(ficha.imagePreviewUrl) : null;

      await gravar(ctx.organizationId, jid, foto);
      if (foto) resultado.atualizadas += 1;
      else resultado.semFoto += 1;
    } catch (error) {
      // Uma foto que não veio não pode derrubar as outras cinquenta.
      resultado.falhas += 1;
      console.warn(`[foto-perfil] ${jid}:`, error instanceof Error ? error.message : error);
    }
    await espera(INTERVALO_MS);
  }

  resultado.restantes = Math.max(0, jids.length - resultado.buscadas);
  return resultado;
}

/** Quantas conversas ainda estão sem foto guardada. Alimenta o rótulo do botão. */
export async function countPendingPictures(ctx: TenantContext): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from conversations c
    left join whatsapp_profile_pictures p
      on p.organization_id = c.organization_id and p.jid = c.remote_jid
    where c.organization_id = ${ctx.organizationId}
      and c.remote_jid is not null
      and p.id is null
  `);
  return (rows as { n: number }[])[0]?.n ?? 0;
}

/**
 * Os bytes de uma foto, para a rota que a serve.
 *
 * Recebe `organizationId` do contexto de sessão, nunca do endereço: é o que
 * impede alguém de ler a foto de um contato de outra clínica trocando o JID
 * na URL.
 */
export async function getPictureBytes(
  organizationId: number,
  jid: string,
): Promise<{ mime: string; bytes: Buffer; fetchedAt: Date } | null> {
  const [row] = await db
    .select({
      mime: whatsappProfilePictures.mime,
      dataBase64: whatsappProfilePictures.dataBase64,
      fetchedAt: whatsappProfilePictures.fetchedAt,
    })
    .from(whatsappProfilePictures)
    .where(
      and(
        eq(whatsappProfilePictures.organizationId, organizationId),
        eq(whatsappProfilePictures.jid, jid),
        eq(whatsappProfilePictures.missing, false),
        isNotNull(whatsappProfilePictures.dataBase64),
      ),
    )
    .limit(1);

  if (!row?.dataBase64) return null;
  return {
    mime: row.mime ?? "image/jpeg",
    bytes: Buffer.from(row.dataBase64, "base64"),
    fetchedAt: row.fetchedAt,
  };
}

/**
 * Quais JIDs de uma lista já têm foto guardada.
 *
 * A lista do Inbox usa isto para decidir entre `<img>` e as iniciais: pedir uma
 * imagem que não existe encheria o console de 404 e piscaria a tela.
 */
export async function whichHavePictures(
  organizationId: number,
  jids: string[],
): Promise<Set<string>> {
  if (jids.length === 0) return new Set();

  const rows = await db
    .select({ jid: whatsappProfilePictures.jid })
    .from(whatsappProfilePictures)
    .where(
      and(
        eq(whatsappProfilePictures.organizationId, organizationId),
        inArray(whatsappProfilePictures.jid, jids),
        eq(whatsappProfilePictures.missing, false),
        isNotNull(whatsappProfilePictures.dataBase64),
      ),
    );

  return new Set(rows.map((r) => r.jid));
}
