import "server-only";

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

async function request<T = any>(
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
  const raw = await request<any>(creds, "GET", "/instance/status");
  const inst = raw?.instance ?? raw ?? {};
  const status = String(inst?.status ?? raw?.status ?? "").toLowerCase();
  return {
    connected: status === "connected" || status === "open",
    status: status || "unknown",
    instanceId: inst?.id ?? inst?.instanceId ?? null,
    instanceName: inst?.name ?? inst?.instanceName ?? null,
    phoneNumber: inst?.owner ? String(inst.owner).split("@")[0] : (inst?.phone ?? raw?.phone ?? null),
    profileName: inst?.profileName ?? inst?.pushName ?? null,
  };
}

export type SendResult = { messageId: string; status: string };

function extractMessageId(resp: any): string {
  // `messageid` é o id curto rastreável; o composto `<owner>:<id>` não casa
  // com o que volta em messages_update.
  return resp?.messageid || resp?.id || resp?.messageId || "";
}

export async function sendText(
  creds: UazapiCredentials,
  to: string,
  text: string,
  opts?: { replyId?: string },
): Promise<SendResult> {
  const resp = await request<any>(creds, "POST", "/send/text", {
    number: to.replace(/@.*$/, ""),
    text,
    replyid: opts?.replyId,
  });
  const messageId = extractMessageId(resp);
  if (!messageId) throw new UazapiError("uazapi /send/text respondeu sem messageid", 500, JSON.stringify(resp).slice(0, 300));
  return { messageId, status: resp?.status || "sent" };
}

export type MediaKind = "image" | "video" | "document" | "audio" | "ptv" | "sticker";

export async function sendMedia(
  creds: UazapiCredentials,
  to: string,
  media: { type: MediaKind; file: string; caption?: string; fileName?: string },
): Promise<SendResult> {
  const resp = await request<any>(creds, "POST", "/send/media", {
    number: to.replace(/@.*$/, ""),
    type: media.type,
    file: media.file,
    text: media.caption,
    docName: media.fileName,
    // `ptt` transforma o áudio em mensagem de voz, que é como o cliente espera receber.
    ptt: media.type === "audio" ? true : undefined,
  });
  const messageId = extractMessageId(resp);
  if (!messageId) throw new UazapiError("uazapi /send/media respondeu sem messageid", 500, JSON.stringify(resp).slice(0, 300));
  return { messageId, status: resp?.status || "sent" };
}

export type ChatCheckResult = { query: string; exists: boolean; jid: string | null };

/**
 * A resposta real é `{query, isInWhatsapp, jid}` — nomes diferentes dos que a
 * documentação sugere. Ler o campo errado fazia todo número parecer inexistente.
 */
export async function checkNumbers(creds: UazapiCredentials, numbers: string[]): Promise<ChatCheckResult[]> {
  const resp = await request<any>(creds, "POST", "/chat/check", { numbers });
  const rows = Array.isArray(resp) ? resp : (resp?.chats ?? resp?.data ?? []);
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    query: String(row?.query ?? row?.number ?? ""),
    exists: Boolean(row?.isInWhatsapp ?? row?.exists ?? row?.isInWhatsApp),
    jid: row?.jid ?? null,
  }));
}

export async function markChatRead(creds: UazapiCredentials, chatId: string): Promise<void> {
  await request(creds, "POST", "/chat/read", { number: chatId.replace(/@.*$/, ""), read: true });
}

/** URL temporária de download de uma mídia recebida. */
export async function downloadMedia(creds: UazapiCredentials, messageId: string): Promise<string | null> {
  const resp = await request<any>(creds, "POST", "/message/download", { id: messageId });
  return resp?.fileURL ?? resp?.url ?? resp?.file ?? null;
}

export async function findMessages(
  creds: UazapiCredentials,
  params: { chatid?: string; limit?: number },
): Promise<any[]> {
  const resp = await request<any>(creds, "POST", "/message/find", {
    chatid: params.chatid,
    limit: params.limit ?? 50,
  });
  const rows = Array.isArray(resp) ? resp : (resp?.messages ?? resp?.data ?? []);
  return Array.isArray(rows) ? rows : [];
}
