import "server-only";
import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  customers,
  messages,
  whatsappGroups,
  whatsappIdentities,
} from "@/db/schema";
import { whichHavePictures } from "@/server/services/profile-picture-service";
import type { TenantContext } from "@/server/auth";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { resolveConversation } from "@/server/services/conversation-resolver";
import { brPhoneVariants } from "@/server/services/outbound-conversation-service";
import { syncConversationHistory } from "@/server/services/whatsapp-message-service";
import { syncProviderChats } from "@/server/services/provider-chat-sync";
import { getRedis } from "@/server/queues/redis";
import { canonicalBrPhone, digitsOnly, phoneFromJid } from "@/server/whatsapp/phone";
import { findChats, listAddressBook, type UazapiCredentials } from "@/server/whatsapp/uazapi-client";
import { listGroups, type Group, type GroupParticipant } from "@/server/whatsapp/uazapi-groups";

/**
 * Caixa de entrada de grupos.
 *
 * LER E SINCRONIZAR SÃO COISAS SEPARADAS, e essa separação é o assunto deste
 * arquivo. Antes a lista se montava perguntando ao WhatsApp na hora: abrir a
 * tela custava uma chamada ao provedor e ainda assim mostrava pouco, porque a
 * lista de grupos não traz última mensagem. Na conta do dono isso dava 298
 * grupos dos quais 2 na primeira página tinham prévia, em ordem alfabética
 * disfarçada de ordem de conversa.
 *
 * Agora a leitura só toca o Postgres, e o Postgres já guarda duas verdades
 * sobre o mesmo grupo: o que passou pelo nosso webhook (tabela `messages`) e o
 * retrato que o aparelho tem da lista (colunas `provider*`, preenchidas por
 * `syncProviderChats`). Elas não competem — a mais RECENTE vence, porque o
 * retrato é cache e uma mensagem nossa posterior a ele é fato novo.
 *
 * A ida ao provedor virou `syncGroupsFromProvider`, que a tela chama depois de
 * já ter pintado. Nenhuma abertura de tela espera o WhatsApp.
 */

export type GroupClassification = "none" | "radar" | "opportunity" | "private";

/** O que a última mensagem era, quando não era texto. A lista vira ícone. */
export type GroupPreviewKind =
  | "text"
  | "photo"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "poll"
  | "location"
  | "contact"
  | "reaction"
  | "other";

export type GroupInboxItem = {
  jid: string;
  name: string;
  description: string | null;
  participantCount: number;
  classification: GroupClassification;
  pinned: boolean;
  conversationId: number | null;
  lastMessageAt: Date | null;
  /** Prévia pronta: a frase dita, ou o que aconteceu ("Foto", "Reagiu com ❤️"). */
  lastMessagePreview: string | null;
  lastMessageKind: GroupPreviewKind | null;
  /** Quem falou, já traduzido para nome. Nulo quando não deu para saber. */
  lastMessageSender: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  /** Última palavra foi do grupo: alguém falou e ninguém respondeu. */
  awaitingReply: boolean;
  /** Foto do grupo guardada, ou nulo quando não há. */
  photoUrl: string | null;
};

export type GroupInboxPage = {
  items: GroupInboxItem[];
  total: number;
  counts: Record<GroupClassification | "all", number>;
  /** Idade do retrato do WhatsApp, em segundos. Nulo quando nunca foi buscado. */
  snapshotAgeSeconds: number | null;
};

// ── Traduzir o que o WhatsApp diz ─────────────────────────────────────────

/**
 * O provedor nomeia o tipo em PascalCase de protocolo (`ImageMessage`,
 * `PollUpdateMessage`). Isso não é para ninguém ler: quem abre a tela quer ver
 * "Foto", como no WhatsApp. O que não estiver aqui cai em texto, que é o caso
 * comum e o mais inofensivo de errar.
 */
const TIPOS_DO_PROVEDOR: Record<string, { kind: GroupPreviewKind; label: string }> = {
  Conversation: { kind: "text", label: "" },
  ExtendedTextMessage: { kind: "text", label: "" },
  ImageMessage: { kind: "photo", label: "Foto" },
  AlbumMessage: { kind: "photo", label: "Álbum de fotos" },
  VideoMessage: { kind: "video", label: "Vídeo" },
  PtvMessage: { kind: "video", label: "Vídeo instantâneo" },
  AudioMessage: { kind: "audio", label: "Áudio" },
  PttMessage: { kind: "audio", label: "Mensagem de voz" },
  DocumentMessage: { kind: "document", label: "Documento" },
  DocumentWithCaptionMessage: { kind: "document", label: "Documento" },
  StickerMessage: { kind: "sticker", label: "Figurinha" },
  ReactionMessage: { kind: "reaction", label: "Reagiu à mensagem" },
  PollCreationMessage: { kind: "poll", label: "Enquete" },
  PollUpdateMessage: { kind: "poll", label: "Voto em enquete" },
  LocationMessage: { kind: "location", label: "Localização" },
  LiveLocationMessage: { kind: "location", label: "Localização em tempo real" },
  ContactMessage: { kind: "contact", label: "Contato" },
  ContactsArrayMessage: { kind: "contact", label: "Contatos" },
  GroupInviteMessage: { kind: "other", label: "Convite de grupo" },
  EventMessage: { kind: "other", label: "Evento" },
  ViewOnceMessage: { kind: "other", label: "Mensagem de visualização única" },
};

/** Os mesmos rótulos para o vocabulário das NOSSAS mensagens. */
const TIPOS_LOCAIS: Record<string, { kind: GroupPreviewKind; label: string }> = {
  text: { kind: "text", label: "" },
  image: { kind: "photo", label: "Foto" },
  video: { kind: "video", label: "Vídeo" },
  audio: { kind: "audio", label: "Áudio" },
  document: { kind: "document", label: "Documento" },
  sticker: { kind: "sticker", label: "Figurinha" },
  location: { kind: "location", label: "Localização" },
  contact: { kind: "contact", label: "Contato" },
  system: { kind: "other", label: "" },
  unsupported: { kind: "other", label: "Mensagem" },
};

/** Uma linha de lista não comporta parágrafo: quebras viram espaço. */
const LIMITE_PREVIA = 180;

function achatar(texto: string | null | undefined): string {
  const limpo = (texto ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > LIMITE_PREVIA ? `${limpo.slice(0, LIMITE_PREVIA - 1)}…` : limpo;
}

/**
 * Monta a prévia do jeito que o WhatsApp monta: com legenda, a legenda é a
 * prévia (o ícone conta que era foto); sem legenda, sobra o rótulo do que
 * aconteceu. Reação é o único caso que vira frase, porque "❤️" sozinho parece
 * mensagem enviada e não é.
 */
export function montarPrevia(
  tipoBruto: string | null,
  texto: string | null,
  dicionario: Record<string, { kind: GroupPreviewKind; label: string }> = TIPOS_DO_PROVEDOR,
): { preview: string | null; kind: GroupPreviewKind | null } {
  const tipo = dicionario[tipoBruto ?? ""] ?? { kind: "text" as GroupPreviewKind, label: "" };
  const corpo = achatar(texto);

  if (tipo.kind === "reaction") {
    return { preview: corpo ? `Reagiu com ${corpo}` : tipo.label, kind: "reaction" };
  }
  if (corpo) return { preview: corpo, kind: tipo.kind };
  if (tipo.label) return { preview: tipo.label, kind: tipo.kind };
  return { preview: null, kind: null };
}

/**
 * O ingestor grava `[imagem]`, `[áudio]` e afins como CORPO da mensagem quando
 * ela não tem texto. Isso é marcação nossa, de dentro do sistema: passar adiante
 * mostraria colchetes na lista onde o WhatsApp mostra "Foto".
 */
const MARCADORES_INTERNOS = new Set([
  "[imagem]",
  "[áudio]",
  "[vídeo]",
  "[documento]",
  "[figurinha]",
  "[localização]",
  "[contato]",
  "[mensagem não suportada]",
]);

/** O mesmo, para uma mensagem que passou pelo nosso webhook. */
export function montarPreviaLocal(
  messageType: string,
  body: string | null,
): { preview: string | null; kind: GroupPreviewKind | null } {
  const texto = achatar(body);
  return montarPrevia(messageType, MARCADORES_INTERNOS.has(texto.toLowerCase()) ? null : texto, TIPOS_LOCAIS);
}

/**
 * O mesmo aparelho aparece como `...:12@lid` e `...@lid` conforme o dispositivo
 * de onde a mensagem saiu. Para saber DE QUEM é, o sufixo só atrapalha.
 */
export function identidadeBase(jid: string | null | undefined): string {
  return (jid ?? "").replace(/:\d+(?=@)/, "").trim();
}

/** ILIKE trata `%` e `_` como curinga; num campo de busca eles são literais. */
function escaparBusca(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Traduz identidades de remetente em nomes.
 *
 * Três fontes, nesta ordem: o cadastro da clínica (é o nome que ELA escolheu),
 * o catálogo montado das conversas diretas do aparelho, e o telefone quando o
 * catálogo só conhece a pessoa por ele. Sem nenhuma delas o resultado é nulo —
 * e nulo aqui significa "mostre só a mensagem", nunca o número cru.
 */
async function resolverRemetentes(
  organizationId: number,
  brutos: Array<string | null>,
): Promise<Map<string, string>> {
  const jids = [...new Set(brutos.map(identidadeBase).filter(Boolean))];
  if (jids.length === 0) return new Map();

  const telefones = [...new Set(jids.map((j) => phoneFromJid(j)).filter((p): p is string => Boolean(p)))];

  const [catalogo, clientes] = await Promise.all([
    db
      .select({ jid: whatsappIdentities.jid, phone: whatsappIdentities.phone, name: whatsappIdentities.name })
      .from(whatsappIdentities)
      .where(
        and(
          eq(whatsappIdentities.organizationId, organizationId),
          telefones.length > 0
            ? or(inArray(whatsappIdentities.jid, jids), inArray(whatsappIdentities.phone, telefones))
            : inArray(whatsappIdentities.jid, jids),
        ),
      ),
    telefones.length > 0
      ? db
          .select({ phone: customers.phone, name: customers.name })
          .from(customers)
          .where(and(eq(customers.organizationId, organizationId), inArray(customers.phone, telefones)))
      : Promise.resolve([] as Array<{ phone: string | null; name: string }>),
  ]);

  const porJid = new Map(catalogo.map((l) => [l.jid, l.name]));
  const porTelefone = new Map<string, string>();
  for (const l of catalogo) if (l.phone) porTelefone.set(l.phone, l.name);
  for (const c of clientes) if (c.phone) porTelefone.set(c.phone, c.name);

  const resultado = new Map<string, string>();
  for (const jid of jids) {
    const telefone = phoneFromJid(jid);
    const nome = (telefone ? porTelefone.get(telefone) : undefined) ?? porJid.get(jid);
    if (nome) resultado.set(jid, nome);
  }
  return resultado;
}

// ── A lista ───────────────────────────────────────────────────────────────

type LinhaLocal = {
  conversation_id: number;
  body: string | null;
  direction: "inbound" | "outbound";
  message_type: string;
  sender_name: string | null;
  audio_transcription: string | null;
  sent_at: Date | null;
  created_at: Date;
};

/**
 * Última mensagem NOSSA de cada conversa da página. Só da página: 30 linhas.
 *
 * A ordem é por `sent_at`, NUNCA por `created_at`. `created_at` é a hora em que
 * a linha entrou no nosso banco, e a reconciliação de histórico traz conversa
 * de meses atrás com `created_at` de agora: ordenar por ele fez um grupo cuja
 * última fala foi em junho aparecer como "42 min" no topo da lista.
 */
async function ultimasMensagens(
  organizationId: number,
  conversationIds: number[],
): Promise<Map<number, LinhaLocal>> {
  if (conversationIds.length === 0) return new Map();
  // `in` com a lista montada à mão: `= any(array)` com o driver `pg` chega ao
  // Postgres como tupla e a consulta falha calada.
  const ids = sql.join(
    conversationIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const { rows } = await db.execute<LinhaLocal>(sql`
    select distinct on (m.conversation_id)
      m.conversation_id, m.body, m.direction, m.message_type, m.sender_name,
      m.audio_transcription, m.sent_at, m.created_at
    from messages m
    where m.organization_id = ${organizationId} and m.conversation_id in (${ids})
    order by m.conversation_id, coalesce(m.sent_at, m.created_at) desc
  `);
  return new Map((rows as LinhaLocal[]).map((r) => [Number(r.conversation_id), r]));
}

export async function listGroupInbox(
  ctx: TenantContext,
  params: { search?: string; classification?: GroupClassification | "all"; limit?: number; offset?: number } = {},
): Promise<GroupInboxPage> {
  const limit = params.limit ?? 30;
  const offset = params.offset ?? 0;
  const filtro = params.classification ?? "all";
  const termo = params.search?.trim();

  const daConta = eq(whatsappGroups.organizationId, ctx.organizationId);
  // Só o NOME. Buscar também na descrição trazia grupo sem o termo à vista, e
  // resultado que ninguém consegue explicar parece defeito.
  const busca = termo ? ilike(whatsappGroups.name, `%${escaparBusca(termo)}%`) : undefined;
  const base = and(daConta, busca);
  const comFiltro = filtro === "all" ? base : and(base, eq(whatsappGroups.classification, filtro));

  /**
   * A ordem da lista é a ordem da atenção, e no WhatsApp isso quer dizer quem
   * falou por último. `greatest` ignora nulo no Postgres, então grupo com só
   * uma das duas datas continua entrando; sem nenhuma, afunda.
   */
  const atividade = sql`greatest(${conversations.lastMessageAt}, ${whatsappGroups.providerLastAt})`;

  const [linhas, [totalRow], porClasse, [retrato], connection] = await Promise.all([
    db
      .select({
        jid: whatsappGroups.jid,
        name: whatsappGroups.name,
        description: whatsappGroups.description,
        participantCount: whatsappGroups.participantCount,
        classification: whatsappGroups.classification,
        pinned: whatsappGroups.pinned,
        providerPreview: whatsappGroups.providerPreview,
        providerPreviewType: whatsappGroups.providerPreviewType,
        providerLastSender: whatsappGroups.providerLastSender,
        providerLastAt: whatsappGroups.providerLastAt,
        providerUnread: whatsappGroups.providerUnread,
        conversationId: conversations.id,
        localUnread: conversations.unreadCount,
        localLastAt: conversations.lastMessageAt,
        localLastOutboundAt: conversations.lastOutboundAt,
      })
      .from(whatsappGroups)
      .leftJoin(
        conversations,
        and(
          eq(conversations.organizationId, whatsappGroups.organizationId),
          eq(conversations.remoteJid, whatsappGroups.jid),
          eq(conversations.isGroup, true),
        ),
      )
      .where(comFiltro)
      .orderBy(desc(whatsappGroups.pinned), sql`${atividade} desc nulls last`, asc(whatsappGroups.name))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(whatsappGroups).where(comFiltro),
    db
      .select({ classification: whatsappGroups.classification, total: sql<number>`count(*)::int` })
      .from(whatsappGroups)
      .where(base)
      .groupBy(whatsappGroups.classification),
    db
      .select({
        idade: sql<number | null>`extract(epoch from (now() - max(${whatsappGroups.providerSyncedAt})))::int`,
      })
      .from(whatsappGroups)
      .where(daConta),
    getConnectionRow(ctx.organizationId),
  ]);

  /**
   * As três consultas seguintes só dependem da PÁGINA, não umas das outras. Em
   * série custariam três idas ao banco (que aqui é remoto, e cada ida é a maior
   * parte do tempo da requisição); juntas custam uma.
   */
  const [locais, nomes, comFoto] = await Promise.all([
    ultimasMensagens(
      ctx.organizationId,
      linhas.map((l) => l.conversationId).filter((id): id is number => typeof id === "number"),
    ),
    resolverRemetentes(
      ctx.organizationId,
      linhas.map((l) => l.providerLastSender),
    ),
    // A foto é resolvida só para a página visível: numa clínica com centenas de
    // grupos, perguntar por todas a cada abertura seria trabalho jogado fora.
    whichHavePictures(
      ctx.organizationId,
      linhas.map((l) => l.jid),
    ),
  ]);

  // Quem assina do nosso próprio número é "Você" — em grupo o WhatsApp mostra
  // assim, e sem isso a nossa própria mensagem apareceria como estranho.
  const nossoTelefone = digitsOnly(connection?.phoneNumber ?? "");

  const items = linhas.map((linha) => {
    const local = linha.conversationId != null ? locais.get(linha.conversationId) : undefined;
    // `lastMessageAt` da conversa é o mesmo relógio que ordena a lista; usar
    // outra data aqui faria a linha mostrar uma hora e ocupar o lugar de outra.
    const ditaEm = local ? new Date(local.sent_at ?? local.created_at) : null;
    const localEm = linha.localLastAt ?? ditaEm;
    const retratoEm = linha.providerLastAt ?? null;

    /**
     * O retrato é cache: mensagem nossa mais recente que ele é fato novo e
     * vence. No EMPATE também vence a nossa, porque das duas descrições do
     * mesmo instante a nossa é a mais rica — tem o nome de quem falou e o tipo
     * certo, enquanto o retrato costuma trazer só uma reação assinada por um
     * `@lid` que ninguém sabe traduzir.
     */
    const localVence = Boolean(localEm && (!retratoEm || localEm.getTime() >= retratoEm.getTime()));

    let lastMessageAt: Date | null = null;
    let preview: string | null = null;
    let kind: GroupPreviewKind | null = null;
    let remetente: string | null = null;
    let fromMe = false;

    /**
     * Não lidas é a contagem do APARELHO, não a nossa. Grupo se lê no celular,
     * e abrir o grupo aqui não marca nada como lido lá — o contador local só
     * cresce. Ele entra apenas quando não existe retrato para consultar.
     */
    const unread = linha.providerUnread ?? linha.localUnread ?? 0;

    if (localVence && local) {
      lastMessageAt = localEm;
      fromMe = local.direction === "outbound";
      // Áudio: a transcrição diz o que foi pedido sem obrigar ninguém a ouvir.
      const corpo = local.message_type === "audio" ? (local.audio_transcription ?? local.body) : local.body;
      ({ preview, kind } = montarPreviaLocal(local.message_type, corpo));
      remetente = fromMe ? "Você" : (local.sender_name?.trim() || null);
    } else if (retratoEm) {
      lastMessageAt = retratoEm;
      const assinatura = identidadeBase(linha.providerLastSender);
      const telefone = phoneFromJid(assinatura);
      fromMe = Boolean(nossoTelefone && telefone === nossoTelefone);
      ({ preview, kind } = montarPrevia(linha.providerPreviewType, linha.providerPreview));
      remetente = fromMe ? "Você" : (nomes.get(assinatura) ?? null);
    } else if (localEm) {
      lastMessageAt = localEm;
    }

    return {
      jid: linha.jid,
      name: linha.name ?? "Grupo sem nome",
      description: linha.description,
      participantCount: linha.participantCount,
      classification: linha.classification,
      pinned: linha.pinned,
      conversationId: linha.conversationId,
      lastMessageAt,
      lastMessagePreview: preview,
      lastMessageKind: kind,
      lastMessageSender: remetente,
      lastMessageFromMe: fromMe,
      unreadCount: unread,
      /**
       * "Sem resposta" só faz sentido onde responder é coisa nossa. Em grupo a
       * última palavra é quase sempre de outra pessoa: marcar toda linha faria
       * o aviso aparecer trinta vezes por tela e não avisar nada. A pergunta
       * certa é se alguém falou DEPOIS da última vez que nós falamos ali.
       */
      awaitingReply: Boolean(
        linha.localLastOutboundAt &&
          lastMessageAt &&
          !fromMe &&
          lastMessageAt.getTime() > linha.localLastOutboundAt.getTime(),
      ),
      photoUrl: null as string | null,
    };
  });

  const counts: GroupInboxPage["counts"] = {
    all: 0,
    none: 0,
    radar: 0,
    opportunity: 0,
    private: 0,
  };
  for (const l of porClasse) {
    counts[l.classification] = l.total;
    counts.all += l.total;
  }

  return {
    items: items.map((g) => ({
      ...g,
      photoUrl: comFoto.has(g.jid) ? `/api/foto-perfil?jid=${encodeURIComponent(g.jid)}` : null,
    })),
    total: totalRow?.total ?? 0,
    counts,
    snapshotAgeSeconds: retrato?.idade ?? null,
  };
}

// ── Sincronização com o WhatsApp ──────────────────────────────────────────

/** Todos os grupos numa chamada só: 298 em 1,1s, contra 1,1s para 50 paginado. */
const ROSTER_LIMIT = 400;
/** Páginas de conversas diretas varridas para montar o catálogo de nomes. */
const PAGINA_CONTATOS = 500;
const MAX_PAGINAS_CONTATOS = 4;
/** A agenda do aparelho pareado. 2.711 contatos nesta conta, 1,4s por página. */
const PAGINA_AGENDA = 1000;
const MAX_PAGINAS_AGENDA = 5;

/** Guarda o retrato do grupo para a próxima abertura já ter nome e tamanho. */
async function upsertGroupSnapshots(
  organizationId: number,
  connectionId: number,
  grupos: Group[],
): Promise<void> {
  if (grupos.length === 0) return;

  await db
    .insert(whatsappGroups)
    .values(
      grupos.map((g) => ({
        organizationId,
        connectionId,
        jid: g.jid,
        name: g.name,
        description: g.description,
        participantCount: g.participantCount,
        lastSyncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: {
        // A classificação é decisão da clínica e nunca é sobrescrita pela sincronia.
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        // Zero significa "não perguntei", não "grupo vazio" — aí o número
        // guardado vale mais. Mas quando a contagem vem de verdade ela MANDA,
        // inclusive para baixo: com `greatest`, um grupo que encolheu ficaria
        // preso no tamanho antigo para sempre.
        participantCount: sql`case when excluded.participant_count > 0 then excluded.participant_count else ${whatsappGroups.participantCount} end`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Monta o catálogo de nomes a partir das conversas diretas do aparelho.
 *
 * Cada linha de conversa direta traz os dois lados da mesma pessoa: o telefone
 * e o `@lid` com que ela assina dentro dos grupos. É isso que transforma
 * "66700892492020@lid: Amanhã fecha" em "Marcos: Amanhã fecha".
 */
async function syncIdentityDirectory(
  organizationId: number,
  creds: UazapiCredentials,
): Promise<number> {
  const encontrados = new Map<string, { phone: string | null; name: string }>();

  for (let pagina = 0; pagina < MAX_PAGINAS_CONTATOS; pagina += 1) {
    const chats = await findChats(creds, {
      limit: PAGINA_CONTATOS,
      offset: pagina * PAGINA_CONTATOS,
      isGroup: false,
    });
    if (chats.length === 0) break;

    for (const chat of chats) {
      const nome = (chat.name ?? "").trim();
      if (!nome) continue;
      const phone = phoneFromJid(chat.jid);
      // Nome que é o próprio número não traduz nada — deixa a linha sem autor,
      // que é melhor do que fingir que "5584..." é gente.
      if (digitsOnly(nome) && digitsOnly(nome) === phone) continue;
      if (chat.jid) encontrados.set(identidadeBase(chat.jid), { phone, name: nome });
      if (chat.chatLid) encontrados.set(identidadeBase(chat.chatLid), { phone, name: nome });
    }

    if (chats.length < PAGINA_CONTATOS) break;
  }

  /**
   * Depois das conversas, a AGENDA do aparelho — e ela vem por cima.
   *
   * As conversas só conhecem quem já escreveu para nós; a agenda tem quem a
   * clínica salvou, que é justamente o nome que o WhatsApp mostra na tela do
   * celular. Medido nesta conta: 1.243 pessoas pelas conversas, 2.711 na
   * agenda. Quando as duas conhecem alguém, vale o da agenda: foi um humano
   * que escreveu aquele nome.
   */
  for (let pagina = 0; pagina < MAX_PAGINAS_AGENDA; pagina += 1) {
    const contatos = await listAddressBook(creds, {
      limit: PAGINA_AGENDA,
      offset: pagina * PAGINA_AGENDA,
    });
    if (contatos.length === 0) break;

    for (const contato of contatos) {
      const phone = phoneFromJid(contato.jid);
      // Contato salvo com o próprio número no lugar do nome não traduz nada —
      // e o provedor ainda devolve mascarado ("+55∙∙∙∙∙∙∙∙00") quem não está
      // salvo. Nenhum dos dois é nome de gente.
      if (contato.name.includes("∙")) continue;
      if (digitsOnly(contato.name) && digitsOnly(contato.name) === phone) continue;
      encontrados.set(identidadeBase(contato.jid), { phone, name: contato.name });
    }

    if (contatos.length < PAGINA_AGENDA) break;
  }

  const linhas = [...encontrados.entries()].map(([jid, dados]) => ({
    organizationId,
    jid,
    phone: dados.phone,
    name: dados.name,
    syncedAt: new Date(),
  }));

  // Em lotes: mil e duzentas linhas num único insert estouram o teto de
  // parâmetros do driver.
  for (let i = 0; i < linhas.length; i += 300) {
    await db
      .insert(whatsappIdentities)
      .values(linhas.slice(i, i + 300))
      .onConflictDoUpdate({
        target: [whatsappIdentities.organizationId, whatsappIdentities.jid],
        set: {
          phone: sql`excluded.phone`,
          name: sql`excluded.name`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  return linhas.length;
}

export type GroupSyncResult = {
  grupos: number;
  retratos: number;
  nomes: number;
  /** Outra aba já estava buscando; esta rodada não repetiu o trabalho. */
  jaEmAndamento: boolean;
};

/**
 * Uma busca por vez na conta.
 *
 * A tela dispara a sincronização sozinha ao abrir, e a clínica abre a tela em
 * várias abas. Sem isto, três abas viram três varreduras simultâneas de 1.500
 * chats na uazapi — que é compartilhada, e cujo tempo de resposta é de todo
 * mundo. O minuto de trava cobre com folga os vinte segundos que ela leva.
 */
const TRAVA_SYNC_S = 60;

/**
 * Busca no WhatsApp tudo que a lista mostra e grava. NUNCA é chamada para
 * abrir a tela: a tela pinta do banco e chama isto depois, ou quando o dono
 * pede. É por isso que ela pode se dar ao luxo de custar segundos.
 */
export async function syncGroupsFromProvider(ctx: TenantContext): Promise<GroupSyncResult> {
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) throw new Error("SEM_CONEXAO");
  const creds = credentialsOf(connection);

  const redis = getRedis();
  const claimed = redis
    ? await redis
        .set(`grupos:provider-sync:${ctx.organizationId}`, "1", "EX", TRAVA_SYNC_S, "NX")
        .catch(() => "OK")
    : "OK";
  if (claimed !== "OK") return { grupos: 0, retratos: 0, nomes: 0, jaEmAndamento: true };

  /**
   * A lista vem COM participantes.
   *
   * Sem eles o provedor devolve zero para todo mundo, e o tamanho do grupo só
   * era descoberto quando alguém abria aquele grupo: 261 dos 298 apareciam sem
   * membro nenhum na conta do dono — a informação que a tela mais promete e
   * menos entregava. Medido no acervo real: 1,7s e 311 KB sem participantes,
   * 5,9s e 2,9 MB com eles, e aí os 298 vêm completos. São segundos de trabalho
   * de FUNDO, numa rota própria, longe da fila de cliques.
   */
  const roster = await listGroups(creds, { limit: ROSTER_LIMIT, offset: 0, withParticipants: true });
  await upsertGroupSnapshots(ctx.organizationId, connection.id, roster.groups);

  /**
   * Grupo do qual saímos pelo celular precisa sumir daqui também — a lista lê
   * do banco agora, e o que ficasse guardado viraria fantasma permanente. Só
   * apaga quando a resposta veio inteira: resposta parcial apagaria grupo vivo
   * junto com a classificação que a clínica deu a ele.
   */
  if (roster.groups.length > 0 && roster.groups.length >= roster.total) {
    await db.delete(whatsappGroups).where(
      and(
        eq(whatsappGroups.organizationId, ctx.organizationId),
        notInArray(
          whatsappGroups.jid,
          roster.groups.map((g) => g.jid),
        ),
      ),
    );
  }

  const retrato = await syncProviderChats(ctx.organizationId);
  const nomes = await syncIdentityDirectory(ctx.organizationId, creds);

  return { grupos: roster.groups.length, retratos: retrato.grupos, nomes, jaEmAndamento: false };
}

/** Esquece o grupo do qual saímos: a lista lê do banco e não do WhatsApp. */
export async function forgetGroup(ctx: TenantContext, jid: string): Promise<void> {
  await db
    .delete(whatsappGroups)
    .where(and(eq(whatsappGroups.organizationId, ctx.organizationId), eq(whatsappGroups.jid, jid)));
}

/** Guarda o tamanho real do grupo, conhecido só quando ele é aberto. */
export async function rememberGroupSize(
  ctx: TenantContext,
  jid: string,
  participantCount: number,
): Promise<void> {
  if (participantCount <= 0) return;
  const connection = await getConnectionRow(ctx.organizationId);
  await db
    .insert(whatsappGroups)
    .values({
      organizationId: ctx.organizationId,
      connectionId: connection?.id ?? null,
      jid,
      participantCount,
    })
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: { participantCount, updatedAt: new Date() },
    });
}

export async function classifyGroup(
  ctx: TenantContext,
  jid: string,
  classification: GroupClassification,
): Promise<void> {
  const connection = await getConnectionRow(ctx.organizationId);
  await db
    .insert(whatsappGroups)
    .values({
      organizationId: ctx.organizationId,
      connectionId: connection?.id ?? null,
      jid,
      classification,
    })
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: { classification, updatedAt: new Date() },
    });
}

export async function toggleGroupPinned(ctx: TenantContext, jid: string, pinned: boolean): Promise<void> {
  const connection = await getConnectionRow(ctx.organizationId);
  await db
    .insert(whatsappGroups)
    .values({ organizationId: ctx.organizationId, connectionId: connection?.id ?? null, jid, pinned })
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: { pinned, updatedAt: new Date() },
    });
}

export type GroupThreadMessage = {
  id: number;
  body: string;
  senderName: string | null;
  direction: "inbound" | "outbound";
  messageType: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  audioTranscription: string | null;
  createdAt: Date;
};

/** Cria o fio local antes da primeira mensagem para que o grupo já seja respondível. */
export async function ensureGroupConversation(ctx: TenantContext, jid: string): Promise<number> {
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) throw new Error("SEM_CONEXAO");
  const [snapshot] = await db
    .select({ name: whatsappGroups.name })
    .from(whatsappGroups)
    .where(and(eq(whatsappGroups.organizationId, ctx.organizationId), eq(whatsappGroups.jid, jid)))
    .limit(1);
  const resolved = await resolveConversation({
    organizationId: ctx.organizationId,
    connectionId: connection.id,
    remoteJid: jid,
    phone: null,
    contactName: snapshot?.name ?? jid.split("@")[0] ?? "Grupo",
    isGroup: true,
  });
  return resolved.conversationId;
}

/**
 * Reconcilia o fio com o que a instância conhece do celular.
 *
 * Separado da leitura DE PROPÓSITO. Enquanto os dois eram a mesma função, abrir
 * um grupo esperava a importação inteira antes de mostrar qualquer coisa: um
 * grupo com quinze mensagens JÁ GRAVADAS aqui ficava com o painel vazio por
 * mais de dezoito segundos (medido) enquanto o /message/find trazia trezentas.
 * O lock evita repetir a busca a cada evento em todas as abas abertas.
 */
export async function reconcileGroupHistory(ctx: TenantContext, jid: string): Promise<number> {
  const conversationId = await ensureGroupConversation(ctx, jid);
  const redis = getRedis();
  const claimed = redis
    ? await redis.set(`groups:history-sync:${ctx.organizationId}:${jid}`, "1", "EX", 20, "NX").catch(() => null)
    : "OK";
  if (claimed !== "OK") return 0;
  return syncConversationHistory(ctx.organizationId, conversationId, 300, { includeGroups: true }).catch((error) => {
    console.warn("[grupos] histórico não reconciliado:", error instanceof Error ? error.message : error);
    return 0;
  });
}

/** Mensagens do grupo que já estão aqui. Não fala com o WhatsApp. */
export async function getGroupThread(
  ctx: TenantContext,
  jid: string,
  opts: { reconcile?: boolean } = {},
): Promise<{ conversationId: number | null; messages: GroupThreadMessage[] }> {
  const conversationId = await ensureGroupConversation(ctx, jid);
  if (opts.reconcile) await reconcileGroupHistory(ctx, jid);

  const linhas = await db
    .select({
      id: messages.id,
      body: messages.body,
      senderName: messages.senderName,
      direction: messages.direction,
      messageType: messages.messageType,
      mediaUrl: messages.mediaUrl,
      mediaMimeType: messages.mediaMimeType,
      mediaFileName: messages.mediaFileName,
      audioTranscription: messages.audioTranscription,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.conversationId, conversationId)))
    .orderBy(desc(sql`coalesce(${messages.sentAt}, ${messages.createdAt})`))
    .limit(120);

  /**
   * A hora da bolha é a do WhatsApp, não a da gravação aqui. Uma conversa
   * reconciliada hoje é toda gravada nos mesmos segundos: por `createdAt`, uma
   * mensagem de 21/08 aparecia carimbada com a hora do clique que a importou.
   */
  const comHoraReal = linhas.map(({ sentAt, createdAt, ...resto }) => ({
    ...resto,
    createdAt: sentAt ?? createdAt,
  }));

  return { conversationId, messages: comHoraReal.reverse() };
}


/**
 * Põe nome em quem o WhatsApp entrega como número.
 *
 * O `/group/info` devolve `DisplayName` vazio para TODO participante — no
 * aplicativo os nomes vêm da agenda do aparelho, que não é nossa. A lista de
 * membros virava uma coluna de telefones, inútil para reconhecer alguém.
 *
 * Duas fontes, nesta ordem: a ficha da própria clínica (é assim que a
 * atendente chama a pessoa) e, depois, o nome que a pessoa usa no WhatsApp,
 * aprendido de quem já falou em algum grupo. Quem não estiver em nenhuma das
 * duas continua aparecendo pelo telefone — nunca por um identificador interno.
 */
export async function nomearParticipantes(
  organizationId: number,
  participantes: GroupParticipant[],
): Promise<GroupParticipant[]> {
  const jids = [...new Set(participantes.map((p) => p.jid).filter(Boolean))];
  /**
   * Telefone casa por TODAS as formas, não pelo texto exato.
   *
   * O provedor entrega o mesmo aparelho ora com o nono dígito, ora sem: nesta
   * base são 2.239 identidades com 12 dígitos e 678 com 13. Comparar string
   * com string deixava "558481225696" e "5584981225696" como duas pessoas
   * diferentes — e a da direita, que tem nome, nunca era encontrada.
   */
  const fones = [
    ...new Set(participantes.flatMap((p) => brPhoneVariants(p.phone)).filter(Boolean)),
  ];
  if (jids.length === 0 && fones.length === 0) return participantes;

  const [identidades, clientes] = await Promise.all([
    jids.length + fones.length > 0
      ? db
          .select({ jid: whatsappIdentities.jid, phone: whatsappIdentities.phone, name: whatsappIdentities.name })
          .from(whatsappIdentities)
          .where(
            and(
              eq(whatsappIdentities.organizationId, organizationId),
              or(
                jids.length ? inArray(whatsappIdentities.jid, jids) : sql`false`,
                fones.length ? inArray(whatsappIdentities.phone, fones) : sql`false`,
              ),
            ),
          )
      : Promise.resolve([]),
    fones.length
      ? db
          .select({ phone: customers.phone, name: customers.name })
          .from(customers)
          .where(and(eq(customers.organizationId, organizationId), inArray(customers.phone, fones)))
      : Promise.resolve([]),
  ]);

  // Os dois lados entram no mapa pela MESMA forma canônica: é o que faz o
  // aparelho de 12 dígitos encontrar o nome guardado com 13.
  const porJid = new Map<string, string>();
  const porFone = new Map<string, string>();
  for (const i of identidades) {
    if (i.jid) porJid.set(i.jid, i.name);
    const chave = canonicalBrPhone(i.phone);
    if (chave) porFone.set(chave, i.name);
  }
  // A ficha da clínica entra por último e por isso vence: é o nome que a
  // atendente escreveu para essa pessoa.
  for (const c of clientes) {
    const chave = canonicalBrPhone(c.phone);
    if (chave) porFone.set(chave, c.name);
  }

  return participantes.map((p) => {
    if (p.displayName) return p;
    const chave = canonicalBrPhone(p.phone);
    const nome = (chave ? porFone.get(chave) : undefined) ?? porJid.get(p.jid);
    return nome ? { ...p, displayName: nome } : p;
  });
}
