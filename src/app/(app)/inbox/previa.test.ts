import { describe, expect, it } from "vitest";
import { type LinhaComPrevia, previaDaConversa } from "./previa";

const NOSSA = "2026-08-24T12:00:00.000Z";
const DEPOIS = "2026-08-24T13:00:00.000Z";
const ANTES = "2026-08-24T11:00:00.000Z";

function linha(patch: Partial<LinhaComPrevia> = {}): LinhaComPrevia {
  return {
    lastMessageAt: NOSSA,
    lastMessagePreview: "nossa frase",
    lastMessageInbound: true,
    lastMessageType: "text",
    lastMessageTranscription: null,
    providerPreview: null,
    providerPreviewType: null,
    providerLastAt: null,
    ...patch,
  };
}

describe("prévia da conversa na lista", () => {
  it("usa a nossa mensagem quando ela é a mais recente", () => {
    const p = previaDaConversa(linha({ providerPreview: "frase velha", providerPreviewType: "Conversation", providerLastAt: ANTES }));
    expect(p.texto).toBe("nossa frase");
  });

  it("usa o retrato do aparelho quando ele é mais novo que tudo que passou por aqui", () => {
    const p = previaDaConversa(
      linha({ providerPreview: "falou agora no celular", providerPreviewType: "Conversation", providerLastAt: DEPOIS }),
    );
    expect(p.texto).toBe("falou agora no celular");
  });

  it("não afirma direção quando quem manda é o retrato", () => {
    const p = previaDaConversa(
      linha({
        lastMessageInbound: false,
        providerPreview: "resposta que não passou pelo webhook",
        providerPreviewType: "ExtendedTextMessage",
        providerLastAt: DEPOIS,
      }),
    );
    // Sem "Você:" nem tique: o provedor identifica quem falou por um @lid que
    // não casa com o jid da conversa.
    expect(p.daCasa).toBe(false);
  });

  it("mantém 'Você:' quando a nossa mensagem é a que aparece", () => {
    expect(previaDaConversa(linha({ lastMessageInbound: false })).daCasa).toBe(true);
  });

  // O empate é o caso COMUM, não a exceção: na conta do dono 20 das 23
  // conversas abertas têm `providerLastAt` idêntico ao nosso `lastMessageAt` —
  // é a mesma mensagem vista pelas duas fontes. Se o retrato vencesse aqui, a
  // lista perderia "Você:" e o tique na maior parte das linhas, e trocaria a
  // frase certa pela versão do cache sempre que as duas discordassem.
  it("empate no relógio não deixa o retrato passar por cima do que temos", () => {
    const p = previaDaConversa(
      linha({
        lastMessageInbound: false,
        providerPreview: "",
        providerPreviewType: "ImageMessage",
        providerLastAt: NOSSA,
      }),
    );
    expect(p.texto).toBe("nossa frase");
    expect(p.daCasa).toBe(true);
  });

  it("socorre a linha vazia: nada nosso exibível, mesmo instante", () => {
    const p = previaDaConversa(
      linha({
        lastMessagePreview: "[mensagem não suportada]",
        lastMessageType: null,
        providerPreview: "o que o telefone sabe",
        providerPreviewType: "Conversation",
        providerLastAt: NOSSA,
      }),
    );
    expect(p.texto).toBe("o que o telefone sabe");
  });

  it("conversa sem nenhuma mensagem nossa herda o retrato", () => {
    const p = previaDaConversa(
      linha({
        lastMessageAt: null,
        lastMessagePreview: null,
        providerPreview: "primeira frase do histórico do aparelho",
        providerPreviewType: "Conversation",
        providerLastAt: DEPOIS,
      }),
    );
    expect(p.texto).toBe("primeira frase do histórico do aparelho");
  });

  it("traduz os tipos do provedor para o português da tela", () => {
    const doAparelho = (providerPreviewType: string, providerPreview: string | null = null) =>
      previaDaConversa(linha({ lastMessageAt: null, lastMessagePreview: null, providerPreview, providerPreviewType, providerLastAt: DEPOIS }));

    expect(doAparelho("ImageMessage").texto).toBe("Foto");
    expect(doAparelho("ImageMessage").tipo).toBe("image");
    expect(doAparelho("PttMessage").texto).toBe("Mensagem de voz");
    expect(doAparelho("AudioMessage").texto).toBe("Mensagem de voz");
    expect(doAparelho("VideoMessage").texto).toBe("Vídeo");
    expect(doAparelho("DocumentMessage").texto).toBe("Documento");
    expect(doAparelho("StickerMessage").texto).toBe("Figurinha");
    expect(doAparelho("PollUpdateMessage").texto).toBe("Enquete");
    expect(doAparelho("ReactionMessage", "🙏").texto).toBe("Reagiu com 🙏");
    expect(doAparelho("ReactionMessage").texto).toBe("Reagiu");
    // Texto é o próprio texto, não um rótulo.
    expect(doAparelho("Conversation", "bom dia").texto).toBe("bom dia");
    expect(doAparelho("ExtendedTextMessage", "bom dia").texto).toBe("bom dia");
    // Legenda vence o rótulo, e o ícone continua o da mídia.
    const comLegenda = doAparelho("ImageMessage", "olha o resultado");
    expect(comLegenda.texto).toBe("olha o resultado");
    expect(comLegenda.tipo).toBe("image");
  });

  it("tipo desconhecido do provedor não deixa a linha vazia", () => {
    const p = previaDaConversa(
      linha({ lastMessageAt: null, lastMessagePreview: null, providerPreviewType: "AlgoQueAindaNaoExiste", providerPreview: "texto que veio junto", providerLastAt: DEPOIS }),
    );
    expect(p.texto).toBe("texto que veio junto");
  });

  it("prefere a transcrição do áudio ao rótulo", () => {
    const p = previaDaConversa(linha({ lastMessageType: "ptt", lastMessagePreview: "[áudio]", lastMessageTranscription: "  pode marcar quinta?  " }));
    expect(p.texto).toBe("pode marcar quinta?");
    expect(p.rotulo).toBe("Mensagem de voz");
  });

  it("conversa sem nada em lugar nenhum diz isso", () => {
    const p = previaDaConversa(linha({ lastMessageAt: null, lastMessagePreview: null }));
    expect(p.texto).toBe("Sem mensagens");
  });
});
