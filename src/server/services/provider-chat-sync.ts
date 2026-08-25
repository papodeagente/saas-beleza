import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, whatsappConnections, whatsappGroups } from "@/db/schema";
import { type FoundChat, findChats } from "@/server/whatsapp/uazapi-client";

/**
 * Traz para o banco o retrato que o WhatsApp tem da lista de conversas.
 *
 * POR QUE ISTO EXISTE: a tela só sabia falar do que passou pelo NOSSO webhook.
 * Um número conectado hoje traz anos de histórico no aparelho, e nada disso
 * chega por webhook — resultado medido nesta conta: 271 dos 298 grupos
 * apareciam como "sem mensagens por aqui" enquanto o telefone sabia a última
 * frase de cada um, quem disse e quantas faltavam ler.
 *
 * `/chat/find` devolve exatamente o que a lista do WhatsApp mostra, e devolve
 * em lote: 300 chats em 1,8s (medido), contra 1,9s do `/group/list` paginado
 * que trazia 50 sem nenhuma dessas informações.
 *
 * É CACHE. Quando existe mensagem nossa mais recente que o retrato, ela vence
 * — a leitura da lista compara as duas datas. Estes campos preenchem só o
 * buraco do que nunca passou por aqui.
 */

/** Uma página cheia por chamada; a instância aceita bem, e menos idas é melhor. */
const PAGINA = 300;
/** Teto de páginas por sincronização, para uma conta enorme não prender o ciclo. */
const MAX_PAGINAS = 4;

function paraData(bruto: number | null): Date | null {
  if (!bruto) return null;
  // O provedor manda ora em segundos, ora em milissegundos. Um timestamp em
  // segundos interpretado como ms cai em 1970 e joga a conversa para o fim da
  // lista; o corte de 10^11 separa os dois com folga até o ano 5138.
  const ms = bruto < 100_000_000_000 ? bruto * 1000 : bruto;
  const data = new Date(ms);
  return Number.isNaN(data.getTime()) ? null : data;
}

export type ProviderSyncResult = { chats: number; conversas: number; grupos: number };

async function gravar(
  organizationId: number,
  chats: FoundChat[],
): Promise<{ conversas: number; grupos: number }> {
  if (chats.length === 0) return { conversas: 0, grupos: 0 };
  const agora = new Date();

  /**
   * UMA consulta por tabela, não uma por chat.
   *
   * A primeira versão fazia um UPDATE por chat: 1.200 chats viraram 2.400 idas
   * ao Postgres e 103 SEGUNDOS de sincronização. Cada ida é uma viagem de rede
   * até o banco do servidor, e o trabalho real de cada uma é uma linha. Um
   * `update ... from (values ...)` faz o mesmo em uma viagem por página.
   */
  // Os tipos vão explícitos na PRIMEIRA linha: num `values` de parâmetros o
  // Postgres não tem de onde inferir e recusa a consulta inteira — falha que
  // aparece como "Failed query" sem dizer a coluna.
  const linhas = sql.join(
    chats.map((chat, i) => {
      const t = (expr: unknown, tipo: string) =>
        i === 0 ? sql`${expr}::${sql.raw(tipo)}` : sql`${expr}`;
      return sql`(${t(chat.jid, "text")}, ${t(chat.preview, "text")}, ${t(chat.previewType, "text")}, ${t(
        chat.lastSender,
        "text",
      )}, ${t(paraData(chat.lastMessageTimestamp), "timestamptz")}, ${t(chat.unreadCount, "integer")}, ${t(
        chat.archived,
        "boolean",
      )})`;
    }),
    sql`, `,
  );

  const colunas = sql`
    set provider_preview      = v.preview,
        provider_preview_type = v.preview_type,
        provider_last_sender  = v.last_sender,
        provider_last_at      = v.last_at,
        provider_unread       = v.unread,
        provider_archived     = v.archived,
        provider_synced_at    = ${agora}
    from (values ${linhas})
      as v(jid, preview, preview_type, last_sender, last_at, unread, archived)
  `;

  // Criar conversa a partir daqui seria tentador e errado: uma conta com mil
  // chats no aparelho encheria a caixa de entrada da clínica com gente que
  // nunca falou com ela. Só ENRIQUECE o que já existe.
  const conv = await db.execute(sql`
    update conversations c ${colunas}
    where c.organization_id = ${organizationId} and c.remote_jid = v.jid
  `);
  const grp = await db.execute(sql`
    update whatsapp_groups g ${colunas}
    where g.organization_id = ${organizationId} and g.jid = v.jid
  `);

  return { conversas: conv.rowCount ?? 0, grupos: grp.rowCount ?? 0 };
}

/**
 * Sincroniza o retrato de todos os chats da conta.
 *
 * Best-effort por definição: é enriquecimento de lista, não caminho crítico.
 * Uma falha aqui deixa a tela com o que ela já tinha, nunca a impede de abrir.
 */
export async function syncProviderChats(organizationId: number): Promise<ProviderSyncResult> {
  const vazio: ProviderSyncResult = { chats: 0, conversas: 0, grupos: 0 };

  const [connection] = await db
    .select({ baseUrl: whatsappConnections.baseUrl, instanceToken: whatsappConnections.instanceToken })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.organizationId, organizationId),
        eq(whatsappConnections.status, "connected"),
        eq(whatsappConnections.active, true),
      ),
    )
    .limit(1);
  if (!connection?.baseUrl || !connection.instanceToken) return vazio;

  const creds = { baseUrl: connection.baseUrl, token: connection.instanceToken };
  const resultado = { ...vazio };

  try {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const chats = await findChats(creds, { limit: PAGINA, offset: pagina * PAGINA });
      if (chats.length === 0) break;
      resultado.chats += chats.length;
      const gravados = await gravar(organizationId, chats);
      resultado.conversas += gravados.conversas;
      resultado.grupos += gravados.grupos;
      if (chats.length < PAGINA) break;
    }
  } catch (error) {
    console.warn(
      "[retrato do provedor] sincronização parcial:",
      error instanceof Error ? error.message : error,
    );
  }

  return resultado;
}

/** Há quanto tempo o retrato foi atualizado, para decidir se vale buscar de novo. */
export async function providerSnapshotAge(organizationId: number): Promise<number | null> {
  const { rows } = await db.execute<{ idade: number | null }>(sql`
    select extract(epoch from (now() - max(provider_synced_at)))::int as idade
    from whatsapp_groups where organization_id = ${organizationId}
  `);
  return (rows as Array<{ idade: number | null }>)[0]?.idade ?? null;
}
