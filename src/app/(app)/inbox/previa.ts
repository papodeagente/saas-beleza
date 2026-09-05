/**
 * A frase que resume uma conversa na lista — e de qual das duas fontes ela vem.
 *
 * Vive num módulo próprio, sem React nem ícones, por dois motivos: é a lógica
 * mais fácil de errar da tela (uma tabela de tradução e uma regra de
 * precedência) e é a única que dá para provar com teste sem subir navegador.
 */

/** Como a mensagem sem texto se anuncia — na bolha e na prévia da lista. */
export const MEDIA_LABEL: Partial<Record<string, string>> = {
  image: "Foto",
  video: "Vídeo",
  audio: "Mensagem de voz",
  ptt: "Mensagem de voz",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  unsupported: "Mensagem não suportada",
};

/**
 * O corpo que a atendente deve ver.
 *
 * O ingestor grava `[áudio]`, `[imagem]` e afins como corpo das mensagens sem
 * texto — é marcador interno para busca e log, não frase. Imprimi-lo embaixo do
 * rótulo "Mensagem de voz" mostrava o encanamento do produto para quem só quer
 * atender.
 */
export function textoVisivel(body: string | null | undefined): string {
  const texto = (body ?? "").trim();
  return /^\[[^\]]*\]$/.test(texto) ? "" : texto;
}

/**
 * Como o WhatsApp nomeia o tipo da última linha, no vocabulário da nossa tela.
 *
 * O retrato do provedor vem em inglês e no jargão do protocolo ("PttMessage").
 * Traduzir para os mesmos nomes das nossas mensagens faz ícone e rótulo saírem
 * iguais, venha a prévia de onde vier — sem uma segunda tabela de rótulos.
 */
export const TIPO_DO_APARELHO: Record<string, string> = {
  Conversation: "text",
  ExtendedTextMessage: "text",
  TemplateMessage: "text",
  ButtonsMessage: "text",
  ButtonsResponseMessage: "text",
  ListMessage: "text",
  ListResponseMessage: "text",
  InteractiveMessage: "text",
  ImageMessage: "image",
  VideoMessage: "video",
  PttMessage: "ptt",
  AudioMessage: "audio",
  DocumentMessage: "document",
  DocumentWithCaptionMessage: "document",
  StickerMessage: "sticker",
  LocationMessage: "location",
  LiveLocationMessage: "location",
  ContactMessage: "contact",
  ContactsArrayMessage: "contact",
  ReactionMessage: "reaction",
  PollCreationMessage: "poll",
  PollUpdateMessage: "poll",
};

/** Tipos que só o retrato conhece; os demais reusam os rótulos das bolhas. */
const ROTULO_DO_APARELHO: Record<string, string> = { poll: "Enquete" };

/** O mínimo que a prévia precisa saber de uma conversa. */
export type LinhaComPrevia = {
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
  lastMessageType: string | null;
  lastMessageTranscription: string | null;
  providerPreview: string | null;
  providerPreviewType: string | null;
  providerLastAt: string | null;
};

export type Previa = {
  texto: string;
  rotulo: string | null;
  /** Tipo já traduzido, para escolher o ícone da linha. */
  tipo: string;
  /** Verdadeiro quando quem falou por último fomos nós — vira "Você:" e tique. */
  daCasa: boolean;
};

/**
 * A frase da prévia, de duas fontes.
 *
 * A nossa última mensagem é a primeira fonte. A segunda é o retrato do
 * aparelho, e ele só entra quando é MAIS NOVO que a nossa — ou quando, no
 * mesmo instante, a nossa não tem nada exibível. Cache não manda em cima do
 * que passou por aqui.
 *
 * Quando o retrato vence, a linha omite "Você:" e o tique: o provedor diz quem
 * falou por um identificador `@lid` que não casa com o `remote_jid` da
 * conversa, e chutar a direção seria pior do que não afirmá-la.
 *
 * Sem esta reserva, conversa cujo histórico nunca passou pelo nosso webhook
 * ficava com a linha vazia enquanto o telefone sabia a última frase.
 */
export function previaDaConversa(conversation: LinhaComPrevia): Previa {
  const nossa = conversation.lastMessageAt ? Date.parse(conversation.lastMessageAt) : 0;
  const doAparelho = conversation.providerLastAt ? Date.parse(conversation.providerLastAt) : 0;

  const tipoLocal = conversation.lastMessageType ?? "text";
  const rotuloLocal = MEDIA_LABEL[tipoLocal] ?? null;
  const corpoLocal =
    tipoLocal === "audio" || tipoLocal === "ptt"
      ? // A transcrição é mais útil que o rótulo: diz o que foi pedido sem ouvir.
        (conversation.lastMessageTranscription?.trim() ?? "")
      : textoVisivel(conversation.lastMessagePreview);
  const temLocal = Boolean(conversation.lastMessageAt) && Boolean(corpoLocal || rotuloLocal);

  const tipoRetrato = TIPO_DO_APARELHO[conversation.providerPreviewType ?? ""] ?? null;
  const corpoRetrato = (conversation.providerPreview ?? "").trim();
  const temRetrato = doAparelho > 0 && Boolean(corpoRetrato || tipoRetrato);

  if (temRetrato && (doAparelho > nossa || (doAparelho === nossa && !temLocal))) {
    const tipo = tipoRetrato ?? "text";
    // Reação não é uma frase da conversa: é alguém apontando para uma frase
    // anterior. Mostrar só o emoji faria a linha parecer uma mensagem de uma
    // letra só.
    if (tipo === "reaction") {
      return {
        texto: corpoRetrato ? `Reagiu com ${corpoRetrato}` : "Reagiu",
        rotulo: null,
        tipo: "text",
        daCasa: false,
      };
    }
    const rotulo = ROTULO_DO_APARELHO[tipo] ?? MEDIA_LABEL[tipo] ?? null;
    // Mídia com legenda mostra a legenda ao lado do ícone, como no aplicativo.
    return { texto: corpoRetrato || rotulo || "Mensagem", rotulo, tipo, daCasa: false };
  }

  const daCasa = !conversation.lastMessageInbound && Boolean(conversation.lastMessageAt);
  if (tipoLocal === "audio" || tipoLocal === "ptt") {
    return { texto: corpoLocal || "Mensagem de voz", rotulo: "Mensagem de voz", tipo: tipoLocal, daCasa };
  }
  if (corpoLocal) return { texto: corpoLocal, rotulo: rotuloLocal, tipo: tipoLocal, daCasa };
  if (rotuloLocal) return { texto: rotuloLocal, rotulo: rotuloLocal, tipo: tipoLocal, daCasa };
  return {
    texto: conversation.lastMessageAt ? "Mensagem" : "Sem mensagens",
    rotulo: null,
    tipo: "text",
    daCasa,
  };
}
