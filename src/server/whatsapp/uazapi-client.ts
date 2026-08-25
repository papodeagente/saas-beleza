import "server-only";
import { asArray, asNumber, asString, firstString, get, type Json } from "@/server/whatsapp/json";

/**
 * Cliente da uazapi.
 *
 * Só o que uma instância já conectada precisa: status, envio e leitura. Não há
 * nada de administração (criar, cobrar, cancelar instância) porque a conexão
 * aqui é manual — o usuário cola URL e token de uma instância que já existe.
 *
 * Autenticação é o header `token` com o token da instância. O tratamento de
 * erro segue o do entur-os-crm: erro tipado por status, retry só no que é
 * transitório, e nunca retry em 4xx que não seja 429.
 */

export type UazapiCredentials = { baseUrl: string; token: string };

export class UazapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "UazapiError";
  }
}
export class UazapiAuthError extends UazapiError {
  constructor(m: string, b: string) {
    super(m, 401, b);
    this.name = "UazapiAuthError";
  }
}
export class UazapiNotFoundError extends UazapiError {
  constructor(m: string, b: string) {
    super(m, 404, b);
    this.name = "UazapiNotFoundError";
  }
}
export class UazapiRateLimitError extends UazapiError {
  constructor(m: string, b: string) {
    super(m, 429, b);
    this.name = "UazapiRateLimitError";
  }
}
export class UazapiServerError extends UazapiError {
  constructor(m: string, b: string, status = 500) {
    super(m, status, b);
    this.name = "UazapiServerError";
  }
}

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Exposto para os módulos que estendem este cliente (grupos, por exemplo). */
export async function uazapiRequest<T = Json>(
  creds: UazapiCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(creds, method, path, body);
}

async function request<T = Json>(
  creds: UazapiCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  /**
   * Envio com atraso nativo segura a resposta HTTP durante todo o atraso (é
   * assim que a uazapi mantém o "Digitando..." aceso). O teto fixo de 30s
   * abortaria qualquer atraso maior — daí o timeout poder ser esticado por
   * chamada.
   */
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const base = normalizeBaseUrl(creds.baseUrl);
  if (!base) throw new UazapiError("URL do servidor uazapi não configurada.", 0, "");
  if (!creds.token) throw new UazapiAuthError("Token da instância não configurado.", "");

  const url = `${base}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { token: creds.token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.ok) {
        const text = await res.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      }

      const text = (await res.text().catch(() => "")).slice(0, 500);
      const label = `uazapi ${method} ${path}`;
      // 4xx é definitivo: repetir só queima tempo e pode duplicar envio.
      if (res.status === 401 || res.status === 403) throw new UazapiAuthError(`${label} → 401`, text);
      if (res.status === 404) throw new UazapiNotFoundError(`${label} → 404`, text);
      if (res.status === 429) {
        lastError = new UazapiRateLimitError(`${label} → 429`, text);
      } else if (res.status >= 500) {
        lastError = new UazapiServerError(`${label} → ${res.status}`, text, res.status);
      } else {
        throw new UazapiError(`${label} → ${res.status} ${text}`, res.status, text);
      }
    } catch (err) {
      if (err instanceof UazapiAuthError || err instanceof UazapiNotFoundError) throw err;
      if (err instanceof UazapiError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new UazapiError(`uazapi ${method} ${path} falhou`, 0, String(lastError));
}

export type UazapiStatus = {
  connected: boolean;
  status: string;
  instanceId: string | null;
  instanceName: string | null;
  phoneNumber: string | null;
  profileName: string | null;
};

/**
 * O shape de /instance/status muda entre versões da uazapi — os campos vivem
 * ora na raiz, ora em `instance`. Ler das duas fontes evita "desconectado"
 * fantasma numa instância que está no ar.
 */
export async function getStatus(creds: UazapiCredentials): Promise<UazapiStatus> {
  const raw = await request(creds, "GET", "/instance/status");
  const inst = get(raw, "instance") ?? raw;
  const status = firstString(get(inst, "status"), get(raw, "status")).toLowerCase();
  const owner = asString(get(inst, "owner"));
  return {
    connected: status === "connected" || status === "open",
    status: status || "unknown",
    instanceId: firstString(get(inst, "id"), get(inst, "instanceId")) || null,
    instanceName: firstString(get(inst, "name"), get(inst, "instanceName")) || null,
    phoneNumber: owner ? owner.split("@")[0] : firstString(get(inst, "phone"), get(raw, "phone")) || null,
    profileName: firstString(get(inst, "profileName"), get(inst, "pushName")) || null,
  };
}

export type PairingResult = {
  qrCode: string | null;
  pairCode: string | null;
  status: string;
  connected: boolean;
};

/**
 * O QR chega como base64 puro em algumas versões e como data URI em outras.
 * A tag `img` precisa do prefixo, então ele é normalizado aqui.
 */
function asDataUri(raw: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  return value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
}

/**
 * Inicia o pareamento da instância.
 *
 * Sem `phone`, a uazapi devolve o QR para escanear. Com `phone`, devolve um
 * código de oito dígitos para digitar no celular — a saída para quem não
 * consegue apontar a câmera para outra tela.
 *
 * A instância já conectada responde sem QR: é assim que se distingue "pronto"
 * de "esperando leitura".
 */
export async function connectInstance(
  creds: UazapiCredentials,
  opts?: { phone?: string },
): Promise<PairingResult> {
  const body: Record<string, unknown> = {};
  if (opts?.phone) {
    const digits = opts.phone.replace(/\D/g, "");
    if (digits.length < 12) {
      // Sem país o pareamento falha silenciosamente do lado do WhatsApp.
      throw new UazapiError("Informe o número com código do país, por exemplo 5511999998888.", 400, "");
    }
    body.phone = digits;
  }

  const resp = await request(creds, "POST", "/instance/connect", body);
  const instance = get(resp, "instance") ?? resp;
  const status = firstString(get(instance, "status"), get(resp, "status")).toLowerCase();
  const qrCode = asDataUri(firstString(get(instance, "qrcode"), get(resp, "qrcode")));

  return {
    qrCode,
    pairCode: firstString(get(instance, "paircode"), get(resp, "paircode")).trim() || null,
    status: status || "unknown",
    connected: (status === "connected" || status === "open") && !qrCode,
  };
}

/**
 * Desconecta o aparelho na uazapi.
 *
 * É logout de verdade: para voltar a receber mensagem é preciso parear de novo.
 * Por isso não é usado em nenhuma rotina automática, só em ação explícita.
 */
export async function disconnectInstance(creds: UazapiCredentials): Promise<void> {
  await request(creds, "POST", "/instance/disconnect", {});
}

export type SendResult = { messageId: string; status: string };

/**
 * Conversas privadas aceitam só o número, mas grupos, LIDs e canais precisam
 * do JID completo. Remover tudo depois do `@` fazia `120...@g.us` virar um
 * número de telefone inexistente justamente nos envios de grupo.
 */
export function recipientId(to: string): string {
  const value = to.trim();
  return value.toLowerCase().endsWith("@s.whatsapp.net") ? value.slice(0, value.lastIndexOf("@")) : value;
}

function extractMessageId(resp: Json): string {
  // `messageid` é o id curto rastreável; o composto `<owner>:<id>` não casa
  // com o que volta em messages_update.
  return firstString(get(resp, "messageid"), get(resp, "id"), get(resp, "messageId"));
}

/**
 * Atraso máximo aceito no envio.
 *
 * A uazapi limita a presença a cinco minutos e é ela quem desenha o
 * "Digitando..." durante o atraso; passar disso só prenderia a requisição sem
 * o cliente ver nada.
 */
const MAX_DELAY_MS = 300_000;

export async function sendText(
  creds: UazapiCredentials,
  to: string,
  text: string,
  opts?: { replyId?: string; mentions?: string[]; linkPreview?: boolean; delayMs?: number; markRead?: boolean },
): Promise<SendResult> {
  /**
   * `delay` é o atraso NATIVO: a uazapi segura a mensagem e mostra
   * "Digitando..." (ou "Gravando áudio...") para o cliente durante a espera.
   * Antes o atraso do agente era um `setTimeout` nosso — o cliente via a tela
   * parada e a resposta simplesmente aparecia depois.
   */
  const delay = Math.min(Math.max(0, Math.round(opts?.delayMs ?? 0)), MAX_DELAY_MS);
  const resp = await request(
    creds,
    "POST",
    "/send/text",
    {
      number: recipientId(to),
      text,
      replyid: opts?.replyId,
      mentions: opts?.mentions?.length ? opts.mentions.join(",") : undefined,
      linkPreview: opts?.linkPreview,
      delay: delay > 0 ? delay : undefined,
      /**
       * Responder é ler — é o que o WhatsApp faz no aparelho.
       *
       * Sem isto a conversa continuava em negrito no celular do dono depois de
       * a atendente responder pelo sistema, e o aparelho ficava com um contador
       * de não lidas que ninguém conseguia zerar de lá. `readchat` limpa a
       * conversa; `readmessages` põe o tique azul no que a cliente mandou.
       * Só vai quando quem envia é gente: disparo automático não leu nada.
       */
      readchat: opts?.markRead ? true : undefined,
      readmessages: opts?.markRead ? true : undefined,
    },
    TIMEOUT_MS + delay,
  );
  const messageId = extractMessageId(resp);
  if (!messageId) throw new UazapiError("uazapi /send/text respondeu sem messageid", 500, JSON.stringify(resp).slice(0, 300));
  return { messageId, status: firstString(get(resp, "status")) || "sent" };
}

/**
 * Tipos aceitos pela uazapi. `ptt` é a mensagem de voz — a que aparece com a
 * onda sonora e toca sem baixar; `audio` vira arquivo anexado, que é outra
 * experiência para quem recebe.
 */
export type MediaKind =
  | "image"
  | "video"
  | "videoplay"
  | "document"
  | "audio"
  | "myaudio"
  | "ptt"
  | "ptv"
  | "sticker";

export async function sendMedia(
  creds: UazapiCredentials,
  to: string,
  media: {
    type: MediaKind;
    /** URL pública ou base64 do arquivo. */
    file: string;
    caption?: string;
    fileName?: string;
    mimetype?: string;
    replyId?: string;
    /** Ver `markRead` em `sendText`: responder é ler, quando quem responde é gente. */
    markRead?: boolean;
  },
): Promise<SendResult> {
  const resp = await request(creds, "POST", "/send/media", {
    number: recipientId(to),
    type: media.type,
    file: media.file,
    text: media.caption,
    docName: media.fileName,
    mimetype: media.mimetype,
    replyid: media.replyId,
    readchat: media.markRead ? true : undefined,
    readmessages: media.markRead ? true : undefined,
  });
  const messageId = extractMessageId(resp);
  if (!messageId) throw new UazapiError("uazapi /send/media respondeu sem messageid", 500, JSON.stringify(resp).slice(0, 300));
  return { messageId, status: firstString(get(resp, "status")) || "sent" };
}

// ── Ações sobre uma mensagem ──────────────────────────────────────────────

/**
 * Reage a uma mensagem. Texto vazio remove a reação, que é como o WhatsApp
 * trata o "desreagir".
 */
export async function reactToMessage(
  creds: UazapiCredentials,
  to: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await request(creds, "POST", "/message/react", {
    number: recipientId(to),
    id: messageId,
    text: emoji,
  });
}

/** Edita o texto de uma mensagem já enviada. O WhatsApp mostra "editada". */
export async function editMessage(creds: UazapiCredentials, messageId: string, text: string): Promise<void> {
  await request(creds, "POST", "/message/edit", { id: messageId, text });
}

/** Apaga para todos. Não há desfazer. */
export async function deleteMessage(creds: UazapiCredentials, messageId: string): Promise<void> {
  await request(creds, "POST", "/message/delete", { id: messageId });
}

export async function markMessagesRead(creds: UazapiCredentials, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await request(creds, "POST", "/message/markread", { id: messageIds });
}

/**
 * Quanto tempo cada aviso de presença fica de pé quando ninguém diz outra coisa.
 *
 * A uazapi reenvia a presença a cada dez segundos até o prazo acabar e a
 * cancela sozinha assim que uma mensagem é enviada para o mesmo chat. O padrão
 * anterior era 3000 ms para os dois casos: bastava para "digitando", porque a
 * tela reavisa a cada três segundos enquanto a pessoa digita, mas apagava o
 * "gravando áudio" três segundos depois de começar a gravação — que é avisada
 * UMA vez só. Gravar um áudio leva mais que isso.
 */
const PRESENCE_DEFAULT_MS: Record<"composing" | "recording" | "paused", number> = {
  composing: 10_000,
  recording: 45_000,
  paused: 0,
};

/**
 * Mostra "digitando" ou "gravando áudio" para o cliente.
 *
 * É o que faz a conversa parecer conversa. Best-effort por natureza: falhar
 * aqui não pode impedir o envio da mensagem.
 */
export async function sendPresence(
  creds: UazapiCredentials,
  to: string,
  presence: "composing" | "recording" | "paused",
  durationMs = PRESENCE_DEFAULT_MS[presence],
): Promise<void> {
  await request(creds, "POST", "/message/presence", {
    number: recipientId(to),
    presence,
    delay: Math.min(Math.max(0, Math.round(durationMs)), MAX_DELAY_MS),
  });
}

export type DownloadedMedia = {
  url: string | null;
  base64: string | null;
  mimeType: string | null;
  transcription: string | null;
};

/**
 * Baixa a mídia de uma mensagem recebida.
 *
 * A uazapi também transcreve áudio aqui quando recebe uma chave da OpenAI, o
 * que evita montar um segundo pipeline de transcrição só para ler o que o
 * cliente falou.
 */
export async function downloadMessageMedia(
  creds: UazapiCredentials,
  messageId: string,
  opts: { transcribe?: boolean; openaiApiKey?: string; returnLink?: boolean } = {},
): Promise<DownloadedMedia> {
  const resp = await request(creds, "POST", "/message/download", {
    id: messageId,
    return_link: opts.returnLink ?? true,
    generate_mp3: true,
    transcribe: opts.transcribe ?? false,
    openai_apikey: opts.openaiApiKey,
  });
  return {
    url: firstString(get(resp, "fileURL"), get(resp, "url"), get(resp, "link")) || null,
    // `base64Data` e `mimetype` são os nomes documentados pela uazapi 2.1.
    // Os aliases antigos continuam aceitos para instâncias ainda não atualizadas.
    base64: firstString(get(resp, "base64Data"), get(resp, "base64")) || null,
    mimeType: firstString(get(resp, "mimetype"), get(resp, "mimeType"), get(resp, "contentType")) || null,
    transcription: firstString(get(resp, "transcription"), get(resp, "text")).trim() || null,
  };
}

export type ChatCheckResult = { query: string; exists: boolean; jid: string | null };

/**
 * A resposta real é `{query, isInWhatsapp, jid}` — nomes diferentes dos que a
 * documentação sugere. Ler o campo errado fazia todo número parecer inexistente.
 */
export async function checkNumbers(creds: UazapiCredentials, numbers: string[]): Promise<ChatCheckResult[]> {
  const resp = await request(creds, "POST", "/chat/check", { numbers });
  const rows = Array.isArray(resp) ? resp : asArray(get(resp, "chats") ?? get(resp, "data"));
  return rows.map((row) => ({
    query: firstString(get(row, "query"), get(row, "number")),
    // O campo real é `isInWhatsapp`; ler o nome errado fazia todo número
    // parecer inexistente.
    exists: Boolean(get(row, "isInWhatsapp") ?? get(row, "exists") ?? get(row, "isInWhatsApp")),
    jid: firstString(get(row, "jid")) || null,
  }));
}

export async function markChatRead(creds: UazapiCredentials, chatId: string): Promise<void> {
  await request(creds, "POST", "/chat/read", { number: recipientId(chatId), read: true });
}

export async function findMessages(
  creds: UazapiCredentials,
  params: { chatid?: string; limit?: number; offset?: number },
): Promise<Json[]> {
  const resp = await request(creds, "POST", "/message/find", {
    chatid: params.chatid,
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  });
  return Array.isArray(resp) ? resp : asArray(get(resp, "messages") ?? get(resp, "data"));
}

/**
 * Pede ao aparelho um bloco anterior do histórico de um chat.
 *
 * Assíncrono por natureza: o WhatsApp só entrega depois que o celular acorda.
 * As mensagens recuperadas entram no acervo da própria uazapi, e a aposta é que
 * elas cheguem até nós pela próxima leitura do /message/find — o evento
 * `history`, que seria a entrega direta, NÃO está assinado nesta instância
 * (`GET /webhook` devolve só messages, messages_update e connection) e a
 * instância é compartilhada, então assiná-lo é decisão de operação, não de
 * código.
 *
 * O indício a favor é que o acervo desta instância guarda mensagens de setembro
 * de 2025 num aparelho pareado em agosto de 2026 — mas isso não separa o que o
 * history-sync trouxe do que já veio na sincronização inicial do pareamento.
 * Quem for confirmar precisa medir a contagem de /message/find de um chat antes
 * e depois de um pedido, com o celular acordado.
 *
 * `number` exige o JID COMPLETO ("JID completo do chat", na documentação).
 * Passar só os dígitos, como faz o resto do cliente, fazia o pedido morrer sem
 * erro visível: nenhuma mensagem voltava e ninguém era avisado.
 */
export async function requestMessageHistory(
  creds: UazapiCredentials,
  chatId: string,
  count = 100,
  /**
   * Mensagem a partir da qual o WhatsApp deve olhar para trás.
   *
   * Sem âncora a uazapi usa "a mensagem mais antiga conhecida LOCALMENTE desse
   * chat" (documentado em /message/history-sync) — o acervo dela, que não é o
   * nosso: numa conversa que ela nunca viu não há âncora nenhuma, e o pedido
   * volta 400 "âncora insuficiente". Mandando a mensagem mais antiga que NÓS
   * temos, o pedido tem de onde partir e busca o bloco anterior a ela, que é
   * exatamente o que falta na tela.
   */
  anchorMessageId?: string | null,
): Promise<void> {
  await request(creds, "POST", "/message/history-sync", {
    number: chatId.trim(),
    mode: "history",
    count: Math.max(1, Math.min(100, count)),
    messageid: anchorMessageId?.trim() || undefined,
  });
}

export type FoundChat = {
  jid: string;
  name: string | null;
  isGroup: boolean;
  /** Timestamp bruto da última mensagem, em segundos ou milissegundos. */
  lastMessageTimestamp: number | null;
  /**
   * O que o WhatsApp mostra na lista de conversas — e que este cliente
   * descartava.
   *
   * Sem estes campos a tela só conseguia falar das conversas cujas mensagens
   * passaram pelo nosso webhook: 271 dos 298 grupos apareciam como "sem
   * mensagens por aqui" enquanto o aparelho sabia exatamente o que tinha sido
   * dito, por quem, quando e quantas faltavam ler. `/chat/find` devolve tudo
   * isso em UMA chamada (300 chats em 1,8s, medido) — mais rápido que o
   * `/group/list` paginado que trazia 50 sem nada disso.
   */
  preview: string | null;
  /** Tipo bruto do provedor: Conversation, ImageMessage, ReactionMessage… */
  previewType: string | null;
  /** Quem mandou a última mensagem. Em grupo é o que vira "Fulano: …". */
  lastSender: string | null;
  unreadCount: number;
  archived: boolean;
  /** Miniatura da foto. Expira — serve para semear o cache, não para exibir. */
  imagePreviewUrl: string | null;
  /**
   * A identidade opaca (`@lid`) desta MESMA pessoa, quando o chat é direto.
   *
   * É a única ponte barata entre o `@lid` que assina as mensagens de grupo e um
   * nome legível: aqui a linha traz os dois lados do par de uma vez.
   */
  chatLid: string | null;
};

/** Lista os chats mais recentes conhecidos pela instância. */
export async function findChats(
  creds: UazapiCredentials,
  params: { limit?: number; offset?: number; isGroup?: boolean } = {},
): Promise<FoundChat[]> {
  const resp = await request(creds, "POST", "/chat/find", {
    operator: "AND",
    sort: "-wa_lastMsgTimestamp",
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    wa_isGroup: params.isGroup,
  });
  const rows = Array.isArray(resp) ? resp : asArray(get(resp, "chats") ?? get(resp, "data"));
  return rows
    .map((row) => {
      const groupValue = get(row, "wa_isGroup");
      const arquivado = get(row, "wa_archived");
      return {
        jid: firstString(get(row, "wa_chatid"), get(row, "chatid"), get(row, "jid")),
        name: firstString(get(row, "name"), get(row, "wa_contactName"), get(row, "wa_name")) || null,
        isGroup: groupValue === true || groupValue === 1 || String(groupValue).toLowerCase() === "true",
        lastMessageTimestamp: asNumber(get(row, "wa_lastMsgTimestamp")) ?? null,
        // O campo se chama `TextVote` porque acumula o texto da mensagem E o
        // voto de enquete; para a lista os dois são a mesma coisa: a última
        // linha dita naquele chat.
        preview: firstString(get(row, "wa_lastMessageTextVote")) || null,
        previewType: firstString(get(row, "wa_lastMessageType")) || null,
        lastSender: firstString(get(row, "wa_lastMessageSender")) || null,
        unreadCount: asNumber(get(row, "wa_unreadCount")) ?? 0,
        archived: arquivado === true || String(arquivado).toLowerCase() === "true",
        imagePreviewUrl: firstString(get(row, "imagePreview"), get(row, "image")) || null,
        chatLid: firstString(get(row, "wa_chatlid")) || null,
      };
    })
    .filter((row) => Boolean(row.jid));
}

export type AddressBookEntry = { jid: string; name: string };

/**
 * A agenda do aparelho pareado — de onde o WhatsApp tira o nome que você vê.
 *
 * `/chat/find` só conhece quem já trocou mensagem com a gente (1.243 pessoas
 * nesta conta); a agenda tem 2.711. É a diferença entre a aba Membros mostrar
 * "Dona Marlene" ou "(84) 9812-9480" para quem nunca escreveu no privado.
 *
 * `contactScope: "address_book"` de propósito: em "all" o provedor devolve
 * também os desconhecidos, com o nome mascarado ("+55∙∙∙∙∙∙∙∙00"), que não é
 * nome de ninguém.
 */
export async function listAddressBook(
  creds: UazapiCredentials,
  params: { limit?: number; offset?: number } = {},
): Promise<AddressBookEntry[]> {
  const resp = await request(creds, "POST", "/contacts/list", {
    limit: params.limit ?? 1000,
    offset: params.offset ?? 0,
    contactScope: "address_book",
  });
  const rows = Array.isArray(resp) ? resp : asArray(get(resp, "contacts"));
  return rows
    .map((row) => ({
      jid: firstString(get(row, "jid"), get(row, "chatid")),
      name: firstString(get(row, "contact_name"), get(row, "contact_FirstName"), get(row, "name")).trim(),
    }))
    .filter((row) => Boolean(row.jid) && Boolean(row.name));
}

// ---------------------------------------------------------------------------
// Ficha do contato
// ---------------------------------------------------------------------------

export type ChatDetails = {
  /** Nome que o contato escolheu para si (`wa_name`), quando existe. */
  waName: string | null;
  /** Nome salvo na agenda do aparelho pareado (`wa_contactName`). */
  contactName: string | null;
  phone: string | null;
  /** Identificador anônimo do contato. Útil para casar conversa vinda de LID. */
  lid: string | null;
  /**
   * URL da MINIATURA da foto de perfil, no CDN do WhatsApp — e ela expira.
   * Quem for exibir isso precisa baixar os bytes, não guardar o link.
   *
   * A imagem em alta resolução (`image`) NÃO é lida aqui de propósito:
   * responde 403 para quem não é o aparelho pareado, então guardá-la só
   * produziria avatar quebrado.
   */
  imagePreviewUrl: string | null;
};

/**
 * Ficha de um contato ou grupo.
 *
 * A resposta vem ora crua, ora envelopada em `chat`, e os campos vazios chegam
 * como string vazia em vez de nulo — daí a normalização aqui em vez de na
 * chamada.
 */
export async function getChatDetails(
  creds: UazapiCredentials,
  jid: string,
): Promise<ChatDetails | null> {
  const resp = await request(creds, "POST", "/chat/details", {
    number: jid,
    preview: true,
  });
  const data = (get(resp, "chat") ?? resp) as Json;
  if (!data || typeof data !== "object") return null;

  const texto = (...valores: unknown[]) => firstString(...valores) || null;

  return {
    waName: texto(get(data, "wa_name"), get(data, "name")),
    contactName: texto(get(data, "wa_contactName"), get(data, "lead_name")),
    phone: texto(get(data, "phone")),
    lid: texto(get(data, "wa_chatlid")),
    imagePreviewUrl: texto(get(data, "imagePreview")),
  };
}
