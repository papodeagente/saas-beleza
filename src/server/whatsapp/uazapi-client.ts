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
): Promise<T> {
  const base = normalizeBaseUrl(creds.baseUrl);
  if (!base) throw new UazapiError("URL do servidor uazapi não configurada.", 0, "");
  if (!creds.token) throw new UazapiAuthError("Token da instância não configurado.", "");

  const url = `${base}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

export async function sendText(
  creds: UazapiCredentials,
  to: string,
  text: string,
  opts?: { replyId?: string; mentions?: string[]; linkPreview?: boolean },
): Promise<SendResult> {
  const resp = await request(creds, "POST", "/send/text", {
    number: recipientId(to),
    text,
    replyid: opts?.replyId,
    mentions: opts?.mentions?.length ? opts.mentions.join(",") : undefined,
    linkPreview: opts?.linkPreview,
  });
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
 * Mostra "digitando" ou "gravando áudio" para o cliente.
 *
 * É o que faz a conversa parecer conversa. Best-effort por natureza: falhar
 * aqui não pode impedir o envio da mensagem.
 */
export async function sendPresence(
  creds: UazapiCredentials,
  to: string,
  presence: "composing" | "recording" | "paused",
  durationMs = 3000,
): Promise<void> {
  await request(creds, "POST", "/message/presence", {
    number: recipientId(to),
    presence,
    delay: durationMs,
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

/** Solicita ao aparelho um bloco anterior do histórico; a resposta é assíncrona. */
export async function requestMessageHistory(
  creds: UazapiCredentials,
  chatId: string,
  count = 100,
): Promise<void> {
  await request(creds, "POST", "/message/history-sync", {
    number: recipientId(chatId),
    mode: "history",
    count: Math.max(1, Math.min(100, count)),
  });
}

export type FoundChat = {
  jid: string;
  name: string | null;
  isGroup: boolean;
  /** Timestamp bruto da última mensagem, em segundos ou milissegundos. */
  lastMessageTimestamp: number | null;
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
      return {
        jid: firstString(get(row, "wa_chatid"), get(row, "chatid"), get(row, "jid")),
        name: firstString(get(row, "name"), get(row, "wa_contactName"), get(row, "wa_name")) || null,
        isGroup: groupValue === true || groupValue === 1 || String(groupValue).toLowerCase() === "true",
        lastMessageTimestamp: asNumber(get(row, "wa_lastMsgTimestamp")) ?? null,
      };
    })
    .filter((row) => Boolean(row.jid));
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
