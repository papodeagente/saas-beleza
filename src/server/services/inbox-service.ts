import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  appointments,
  conversations,
  customerTagLinks,
  customerTags,
  customers,
  messages,
  organizationMembers,
  payments,
  professionals,
  services,
  users,
  whatsappProfilePictures,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { whichHavePictures } from "@/server/services/profile-picture-service";
import { formatBrPhone } from "@/server/whatsapp/phone";
import { brPhoneVariants } from "@/server/services/outbound-conversation-service";

/**
 * Inbox: a conversa e o contexto do cliente na mesma tela.
 *
 * A divisão em filas segue a regra trazida do entur-os-crm: "Meus" é o que
 * está atribuído a você, "Fila" é o que não tem dono e "Todos" é a visão do
 * time. Mensagem nova de conversa sem dono cai na fila mesmo que alguém já a
 * tenha atendido antes — quem atendeu por último aparece como contexto, não
 * como dono, porque essa pessoa pode estar de folga.
 */

export type InboxTab = "meus" | "fila" | "todos" | "resolvidas";

export type InboxAssignee = {
  userId: number;
  name: string;
  role: "owner" | "admin" | "staff";
};

/** Pessoas que de fato podem operar o Inbox e receber uma transferência. */
export async function listInboxAssignees(ctx: TenantContext): Promise<InboxAssignee[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, ctx.organizationId),
        inArray(organizationMembers.role, ["owner", "admin", "staff"]),
      ),
    )
    .orderBy(asc(users.name));

  // O banco já filtrou; a guarda deixa o estreitamento explícito também para
  // o TypeScript, sem fingir um tipo por coerção.
  return rows.filter((row): row is InboxAssignee => row.role !== "professional");
}

export type ConversationListItem = {
  id: number;
  customerId: number | null;
  customerName: string;
  phone: string | null;
  channel: string;
  controlledBy: "ai" | "human" | "waiting";
  status: string;
  aiPaused: boolean;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
  /** Tipo da última mensagem, para a lista mostrar "Foto" no lugar de vazio. */
  lastMessageType: string | null;
  /** Situação de entrega da última mensagem de saída. */
  lastMessageStatus: string | null;
  lastMessageTranscription: string | null;
  /**
   * Retrato do provedor: o que o aparelho sabe da última linha desta conversa.
   *
   * Entra como RESERVA, nunca por cima: a lista compara `providerLastAt` com a
   * data da nossa última mensagem e só usa o retrato quando ele é mais novo.
   * Sem isso, conversa cujo histórico nunca passou pelo nosso webhook aparecia
   * vazia enquanto o telefone sabia a frase, quem falou e quantas faltavam ler.
   */
  providerPreview: string | null;
  providerPreviewType: string | null;
  providerLastAt: Date | null;
  providerUnread: number | null;
  /**
   * A maior entre a data da nossa última mensagem e a do retrato. É por ela que
   * a lista se ordena — ordenar só pela nossa jogava para o fim conversas que
   * acabaram de falar no aparelho.
   */
  lastActivityAt: Date | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  lastAssignedUserName: string | null;
  /**
   * Endereço da foto de perfil guardada, ou nulo quando não há foto para este
   * contato. Nulo faz o Avatar cair nas iniciais — pedir uma imagem que não
   * existe encheria o console de 404 e faria a lista piscar.
   */
  photoUrl: string | null;
};

/**
 * Teto de linhas da lista.
 *
 * Exportado porque o Inbox carrega TODAS as conversas abertas de uma vez e
 * fatia "Meus", "Fila" e "Todos" no cliente. Quem fatia precisa saber onde o
 * retrato acaba: acima deste teto o subconjunto no cliente mentiria, e o
 * caminho volta a ser uma consulta por aba.
 */
export const LIMITE_DA_LISTA = 100;

function tabFilter(ctx: TenantContext, tab: InboxTab) {
  switch (tab) {
    case "meus":
      return and(eq(conversations.assignedUserId, ctx.userId), eq(conversations.status, "open"));
    case "fila":
      return and(isNull(conversations.assignedUserId), eq(conversations.status, "open"));
    case "resolvidas":
      return eq(conversations.status, "closed");
    default:
      return eq(conversations.status, "open");
  }
}

export async function listConversations(
  ctx: TenantContext,
  options: {
    tab?: InboxTab;
    search?: string;
    /** Filtro adicional da visão Todos; as outras abas já definem o dono. */
    assignee?: "all" | "unassigned" | number;
  } = {},
): Promise<ConversationListItem[]> {
  const tab = options.tab ?? "meus";
  const search = options.search?.trim();
  const assigneeFilter =
    tab !== "todos" || options.assignee == null || options.assignee === "all"
      ? undefined
      : options.assignee === "unassigned"
        ? isNull(conversations.assignedUserId)
        : eq(conversations.assignedUserId, options.assignee);

  /**
   * A última mensagem de CADA conversa, uma consulta por linha exibida.
   *
   * A versão anterior usava `row_number() over (partition by ...)` sobre TODAS
   * as mensagens da organização e descartava tudo menos a primeira de cada
   * partição. Medido numa base de 230 mil mensagens: 1.425 ms na aba padrão,
   * porque o Postgres re-executava a ordenação inteira uma vez por conversa
   * atribuída (7,8 milhões de linhas ordenadas, 430 MB de arquivo temporário).
   * Havia ainda a inversão perversa de que quanto MENOS conversas o atendente
   * tinha, mais vezes a subconsulta rodava.
   *
   * O LATERAL lê só a ponta de cada conversa, pelo índice
   * `messages_conversation_idx` que já existia. Mesma base: 1,4 ms.
   *
   * Traz também tipo, direção e status — é o que a lista precisa para mostrar
   * "📷 Foto", "Você: …" e o tique de entrega de verdade, sem denormalizar nada.
   */
  const lastMessage = db
    .select({
      body: messages.body,
      direction: messages.direction,
      messageType: messages.messageType,
      status: messages.status,
      audioTranscription: messages.audioTranscription,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversations.id))
    // Mesma régua do fio: a prévia é a ÚLTIMA mensagem da conversa, e última é
    // pelo que aconteceu, não pelo que foi gravado por último.
    .orderBy(desc(aconteceuEm), desc(messages.id))
    .limit(1)
    .as("last_message");

  // Alias porque a junção é por (organização, jid) e a mesma tabela pode voltar
  // a ser usada noutro ponto da consulta.
  const profilePic = alias(whatsappProfilePictures, "profile_pic");

  const assignee = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .as("assignee");
  const previous = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .as("previous_assignee");

  const rows = await db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      customerName: sql<string>`coalesce(${customers.name}, ${conversations.contactName}, 'Contato sem cadastro')`,
      phone: sql<string | null>`coalesce(${customers.phone}, ${conversations.phone})`,
      channel: conversations.channel,
      controlledBy: conversations.controlledBy,
      status: conversations.status,
      aiPausedAt: conversations.aiPausedAt,
      unreadCount: conversations.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: lastMessage.body,
      lastMessageInbound: sql<boolean>`${lastMessage.direction} = 'inbound'`,
      lastMessageType: lastMessage.messageType,
      lastMessageStatus: lastMessage.status,
      lastMessageTranscription: lastMessage.audioTranscription,
      providerPreview: conversations.providerPreview,
      providerPreviewType: conversations.providerPreviewType,
      providerLastAt: conversations.providerLastAt,
      providerUnread: conversations.providerUnread,
      // `greatest` do Postgres IGNORA nulo (só devolve nulo se todos forem),
      // que é exatamente o que se quer: conversa sem retrato mantém a nossa
      // data, conversa sem mensagem nossa herda a do aparelho.
      // `mapWith` não é enfeite: o drizzle desliga o conversor de data do
      // driver e faz a conversão pela COLUNA. Uma expressão crua escapa disso e
      // chega como texto — `lastActivityAt.toISOString()` explodia a página.
      lastActivityAt: sql<Date | null>`greatest(${conversations.lastMessageAt}, ${conversations.providerLastAt})`.mapWith(
        conversations.lastMessageAt,
      ),
      assignedUserId: conversations.assignedUserId,
      assignedUserName: assignee.name,
      lastAssignedUserName: previous.name,
      remoteJid: conversations.remoteJid,
      // Só a existência da foto vem no SELECT. Trazer os bytes aqui carregaria
      // ~2,6 KB por linha em toda abertura do inbox, para uma imagem que o
      // navegador já sabe guardar em cache sozinho.
      temFoto: sql<boolean>`${profilePic.id} is not null`,
    })
    .from(conversations)
    .leftJoin(
      profilePic,
      and(
        eq(profilePic.organizationId, conversations.organizationId),
        eq(profilePic.jid, conversations.remoteJid),
        eq(profilePic.missing, false),
      ),
    )
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
    .leftJoin(previous, eq(previous.id, conversations.lastAssignedUserId))
    .leftJoinLateral(lastMessage, sql`true`)
    .where(
      and(
        eq(conversations.organizationId, ctx.organizationId),
        // Grupo não é atendimento: tem caixa própria, com classificação em vez
        // de fila. Misturar os dois enche a fila de clientes com ruído.
        eq(conversations.isGroup, false),
        tabFilter(ctx, tab),
        assigneeFilter,
        search
          ? or(
              ilike(customers.name, `%${search}%`),
              ilike(conversations.contactName, `%${search}%`),
              // Só entra quando a busca TEM dígitos: "Eliseu" virava a máscara
              // `%%`, que casa com qualquer telefone — a busca por nome
              // devolvia a caixa inteira em vez da pessoa procurada.
              search.replace(/\D/g, "")
                ? ilike(conversations.phone, `%${search.replace(/\D/g, "")}%`)
                : undefined,
            )
          : undefined,
      ),
    )
    // Ordenar pela data EFETIVA. Pela nossa apenas, uma conversa cujo histórico
    // só existe no aparelho caía para o fim da lista mesmo tendo falado agora.
    .orderBy(sql`greatest(${conversations.lastMessageAt}, ${conversations.providerLastAt}) desc nulls last`)
    .limit(LIMITE_DA_LISTA);

  return rows.map(({ remoteJid, temFoto, ...row }) => ({
    ...row,
    aiPaused: Boolean(row.aiPausedAt),
    phone: row.phone ? formatBrPhone(row.phone) : null,
    photoUrl:
      temFoto && remoteJid ? `/api/foto-perfil?jid=${encodeURIComponent(remoteJid)}` : null,
  }));
}

export type InboxCounts = { meus: number; fila: number; todos: number };

export async function countByTab(ctx: TenantContext): Promise<InboxCounts> {
  const [row] = await db
    .select({
      meus: sql<number>`count(*) filter (where ${conversations.assignedUserId} = ${ctx.userId} and ${conversations.status} = 'open')::int`,
      fila: sql<number>`count(*) filter (where ${conversations.assignedUserId} is null and ${conversations.status} = 'open')::int`,
      todos: sql<number>`count(*) filter (where ${conversations.status} = 'open')::int`,
    })
    .from(conversations)
    .where(and(eq(conversations.organizationId, ctx.organizationId), eq(conversations.isGroup, false)));
  return row ?? { meus: 0, fila: 0, todos: 0 };
}

/**
 * Zera o não lido do RETRATO ao abrir a conversa.
 *
 * A lista mostra o maior entre o nosso não lido e o do aparelho — o nosso só
 * conta o que passou pelo webhook, e nesta conta havia conversa com 27 no
 * telefone e 6 aqui. Mas o retrato é uma fotografia periódica: sem esta
 * escrita, abrir a conversa apagava só o nosso contador e o número do aparelho
 * ressuscitava o crachá no primeiro refresh, até a próxima sincronização.
 *
 * Escrever aqui é honesto porque a abertura também manda a confirmação de
 * leitura para o WhatsApp: o aparelho vai zerar de qualquer forma, e isto
 * apenas antecipa o que a próxima fotografia confirmaria.
 */
export async function clearProviderUnread(organizationId: number, conversationId: number): Promise<void> {
  await db
    .update(conversations)
    .set({ providerUnread: 0 })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)));
}

export type ConversationMessage = {
  id: number;
  direction: "inbound" | "outbound";
  sender: "customer" | "user" | "ai" | "system";
  senderName: string | null;
  body: string;
  messageType: string;
  status: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  audioTranscription: string | null;
  externalId: string | null;
  quotedExternalId: string | null;
  reactions: Array<{ emoji: string; fromMe: boolean }> | null;
  deletedAt: Date | null;
  createdAt: Date;
};

export type ConversationContext = {
  customerId: number;
  name: string;
  phone: string | null;
  email: string | null;
  visitsCount: number;
  noShowCount: number;
  totalSpentCents: number;
  lastVisitAt: Date | null;
  /** Derivado do histórico, não digitado: é o que resume a relação num olhar. */
  stage: "novo" | "ativo" | "recorrente" | "sumido";
  tags: string[];
  appointmentsCount: number;
  nextAppointments: Array<{
    id: number;
    startsAt: Date;
    serviceName: string;
    professionalName: string;
    status: string;
  }>;
};

/**
 * Estágio do cliente a partir do que aconteceu, não de um campo que alguém
 * precisa lembrar de atualizar.
 */
function customerStage(visits: number, lastVisitAt: Date | null): ConversationContext["stage"] {
  if (visits === 0) return "novo";
  const dias = lastVisitAt ? (Date.now() - lastVisitAt.getTime()) / 86_400_000 : Infinity;
  if (dias > 120) return "sumido";
  return visits >= 4 ? "recorrente" : "ativo";
}

export type ConversationDetail = {
  conversation: {
    id: number;
    customerName: string;
    phone: string | null;
    channel: string;
    controlledBy: "ai" | "human" | "waiting";
    status: string;
    aiPaused: boolean;
    /** Foto de perfil guardada, ou nulo quando não há. */
    photoUrl: string | null;
    assignedUserId: number | null;
    assignedUserName: string | null;
    lastAssignedUserName: string | null;
    hasWhatsapp: boolean;
  };
  messages: ConversationMessage[];
  context: ConversationContext | null;
};

/**
 * QUANDO A MENSAGEM ACONTECEU.
 *
 * `messages` guarda dois carimbos e eles não são a mesma coisa: `sent_at` é o
 * instante no WhatsApp, e `created_at` é quando NÓS gravamos a linha. Para
 * mensagem que chega ao vivo pelo webhook os dois ficam a milissegundos um do
 * outro e a diferença não aparece. Para mensagem IMPORTADA do histórico, todas
 * nascem com `created_at = now()` da importação carregando o `sent_at`
 * verdadeiro e antigo — e aí ordenar por `created_at` põe julho depois de
 * ontem.
 *
 * Medido em produção quando o dono relatou: 3.219 das 4.534 mensagens tinham
 * mais de cinco minutos de diferença entre os dois carimbos, e 34 das 158
 * conversas mudavam de ordem por causa disso. Na conversa 443, mensagens de
 * 31/07 gravadas em 25/08 às 03:41 apareciam ENTRE as de 25/08 12:00 e as de
 * 26/08 00:24.
 *
 * O `coalesce` cobre as seis mensagens de demonstração que nasceram sem
 * `sent_at`: nelas o `created_at` É o instante pretendido.
 *
 * Vive aqui, exportado, para que a lista, o fio e os grupos não possam divergir
 * — duas definições de "quando aconteceu" é como isto começou.
 */
export const aconteceuEm = sql<Date>`coalesce(${messages.sentAt}, ${messages.createdAt})`.mapWith(
  // `mapWith` não é enfeite: expressão SQL crua perde o mapeamento de tipo da
  // coluna e o driver devolve TEXTO. A tela então chamava `.toISOString()` num
  // string e quebrava o fio inteiro — os testes não pegaram porque
  // `new Date(texto)` funciona.
  messages.createdAt,
);

export async function getConversation(
  ctx: TenantContext,
  conversationId: number,
): Promise<ConversationDetail | null> {
  const assignee = db.select({ id: users.id, name: users.name }).from(users).as("assignee");
  const previous = db.select({ id: users.id, name: users.name }).from(users).as("previous_assignee");

  const [conversation] = await db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      customerName: sql<string>`coalesce(${customers.name}, ${conversations.contactName}, 'Contato sem cadastro')`,
      phone: sql<string | null>`coalesce(${customers.phone}, ${conversations.phone})`,
      channel: conversations.channel,
      controlledBy: conversations.controlledBy,
      status: conversations.status,
      aiPausedAt: conversations.aiPausedAt,
      assignedUserId: conversations.assignedUserId,
      assignedUserName: assignee.name,
      lastAssignedUserName: previous.name,
      remoteJid: conversations.remoteJid,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
    .leftJoin(previous, eq(previous.id, conversations.lastAssignedUserId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, ctx.organizationId)))
    .limit(1);
  if (!conversation) return null;

  const sender = db.select({ id: users.id, name: users.name }).from(users).as("message_sender");
  const mensagensQ = db
    .select({
      id: messages.id,
      direction: messages.direction,
      sender: messages.sender,
      senderName: sender.name,
      body: messages.body,
      messageType: messages.messageType,
      status: messages.status,
      mediaUrl: messages.mediaUrl,
      mediaMimeType: messages.mediaMimeType,
      mediaFileName: messages.mediaFileName,
      audioTranscription: messages.audioTranscription,
      externalId: messages.externalId,
      quotedExternalId: messages.quotedExternalId,
      // O jsonb chega como `unknown`; a forma é garantida por quem escreve
      // (applyReaction), então a asserção fica no único ponto de leitura.
      reactions: sql<Array<{ emoji: string; fromMe: boolean }> | null>`${messages.reactions}`,
      deletedAt: messages.deletedAt,
      // O que a tela chama de `createdAt` é o instante em que a mensagem
      // ACONTECEU: é dele que saem o separador de data e o horário da bolha.
      createdAt: aconteceuEm,
    })
    .from(messages)
    .leftJoin(sender, eq(sender.id, messages.senderUserId))
    .where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.conversationId, conversationId)))
    // `desc` e não `asc`: com `asc` o limite trazia as 200 mensagens MAIS
    // ANTIGAS, então toda conversa acima disso congelava no histórico velho e a
    // mensagem que a atendente acabava de enviar nunca aparecia — nem no
    // recarregamento. O desempate por id importa porque dois inbounds podem
    // cair no mesmo milissegundo, e sem ele o corte escolhe arbitrariamente
    // qual sobrevive.
    .orderBy(desc(aconteceuEm), desc(messages.id))
    .limit(200);

  /**
   * O contexto do cliente tem dependência interna (as fichas irmãs pelas
   * variações do telefone alimentam as métricas), então vive numa função
   * própria — que roda em PARALELO com as mensagens e com a foto. A versão
   * anterior enfileirava seis idas ao banco uma atrás da outra, e cada ida é
   * uma viagem de rede inteira até o Postgres do Coolify: a abertura da
   * conversa pagava a soma, não o máximo.
   */
  const carregarContexto = async (): Promise<ConversationContext | null> => {
    if (!conversation.customerId) return null;
    const customerId = conversation.customerId;

    const variants = brPhoneVariants(conversation.phone);
    const [[customer], related] = await Promise.all([
      db
      .select({
        customerId: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        visitsCount: customers.visitsCount,
        noShowCount: customers.noShowCount,
        totalSpentCents: customers.totalSpentCents,
        lastVisitAt: customers.lastVisitAt,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1),
      // Cadastros antigos podem guardar o mesmo WhatsApp com/sem DDI e com/sem
      // nono dígito. O Inbox precisa mostrar a relação inteira, mesmo antes de
      // a gestão decidir mesclar as fichas duplicadas.
      variants.length
        ? db
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.organizationId, ctx.organizationId), inArray(customers.phone, variants)))
        : Promise.resolve([] as Array<{ id: number }>),
    ]);
    const customerIds = [...new Set([customerId, ...related.map((row) => row.id)])];

    const [allAppointments, appointmentMetrics, paymentMetrics, tags] = await Promise.all([
      db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        serviceName: services.name,
        professionalName: professionals.name,
        status: appointments.status,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          inArray(appointments.customerId, customerIds),
        ),
      )
      .orderBy(desc(appointments.startsAt)),
      db
        .select({
          visitsCount: sql<number>`count(*) filter (where ${appointments.status} = 'completed')::int`.mapWith(Number),
          noShowCount: sql<number>`count(*) filter (where ${appointments.status} = 'no_show')::int`.mapWith(Number),
          lastVisitAt: sql<Date | null>`max(${appointments.startsAt}) filter (where ${appointments.status} = 'completed')`,
        })
        .from(appointments)
        .where(and(eq(appointments.organizationId, ctx.organizationId), inArray(appointments.customerId, customerIds))),
      db
        .select({ totalSpentCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`.mapWith(Number) })
        .from(payments)
        .where(and(eq(payments.organizationId, ctx.organizationId), inArray(payments.customerId, customerIds))),
      db
        .select({ name: customerTags.name })
        .from(customerTagLinks)
        .innerJoin(customerTags, eq(customerTags.id, customerTagLinks.tagId))
        .where(eq(customerTagLinks.customerId, customerId))
        .limit(8),
    ]);

    if (!customer) return null;
    const metrics = appointmentMetrics[0] ?? { visitsCount: 0, noShowCount: 0, lastVisitAt: null };
    return {
      ...customer,
      ...metrics,
      totalSpentCents: paymentMetrics[0]?.totalSpentCents ?? 0,
      stage: customerStage(metrics.visitsCount, metrics.lastVisitAt),
      tags: tags.map((t) => t.name),
      appointmentsCount: allAppointments.length,
      nextAppointments: allAppointments,
    };
  };

  const [temFoto, rows, context] = await Promise.all([
    // Leitura por chave única, em paralelo — não vale uma junção na consulta
    // principal, mas também não vale uma viagem própria em série.
    conversation.remoteJid
      ? whichHavePictures(ctx.organizationId, [conversation.remoteJid]).then((set) => set.size > 0)
      : Promise.resolve(false),
    mensagensQ,
    carregarContexto(),
  ]);

  return {
    conversation: {
      id: conversation.id,
      customerName: conversation.customerName,
      phone: conversation.phone ? formatBrPhone(conversation.phone) : null,
      channel: conversation.channel,
      controlledBy: conversation.controlledBy,
      status: conversation.status,
      aiPaused: Boolean(conversation.aiPausedAt),
      assignedUserId: conversation.assignedUserId,
      assignedUserName: conversation.assignedUserName,
      lastAssignedUserName: conversation.lastAssignedUserName,
      hasWhatsapp: Boolean(conversation.remoteJid),
      photoUrl:
        conversation.remoteJid && temFoto
          ? `/api/foto-perfil?jid=${encodeURIComponent(conversation.remoteJid)}`
          : null,
    },
    // A consulta vem do mais novo para o mais velho (para o limite pegar a
    // ponta certa da conversa); a tela lê de cima para baixo.
    messages: rows.reverse(),
    context,
  };
}

export const _refs = { count };
