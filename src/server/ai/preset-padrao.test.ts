import { describe, expect, it } from "vitest";
import { apenasSituacoesConhecidas, PADRAO, SITUACOES_DE_TRANSFERENCIA } from "@/domain/agente";
import { montarPresetPadrao } from "./preset-padrao";

const base = {
  tom: PADRAO.tom,
  emoji: PADRAO.emoji,
  objetivo: null,
  transferirQuando: PADRAO.transferirQuando,
};

describe("preset da configuração padrão", () => {
  it("declara que as regras fixas continuam valendo", () => {
    // Sem esta linha, "sempre conduza ao agendamento" briga em silêncio com a
    // regra fixa "se não souber, transfira" — as duas certas, a combinação
    // errada.
    expect(montarPresetPadrao(base)).toContain("As regras acima valem sempre");
  });

  it("NÃO repete o que o prompt fixo já diz", () => {
    // Reescrever regra que já existe com outras palavras cria instrução
    // concorrente, que é pior do que instrução nenhuma.
    const texto = montarPresetPadrao(base).toLowerCase();
    for (const jaFixa of [
      "uma pergunta por vez",
      "sem travessão",
      "no máximo três frases",
      "confirme serviço, data e hora",
      "nunca deduza",
    ]) {
      expect(texto).not.toContain(jaFixa);
    }
  });

  it("manda conduzir para o próximo passo, que é o que o prompt fixo não cobre", () => {
    const texto = montarPresetPadrao(base);
    expect(texto).toContain("um passo adiante");
    expect(texto).toContain("resposta pela metade");
  });

  it("limita a oferta a duas a quatro opções e nomeia a ferramenta de varredura", () => {
    const texto = montarPresetPadrao(base);
    expect(texto).toContain("duas a quatro opções");
    expect(texto).toContain("next_available_slots");
  });

  it("cobre as três objeções, e proíbe desconto e urgência inventada", () => {
    const texto = montarPresetPadrao(base);
    expect(texto).toContain("caro");
    expect(texto).toContain("vai pensar");
    expect(texto).toContain("vê depois");
    expect(texto).toContain("Nunca ofereça desconto");
    expect(texto).toContain("Nunca invente urgência");
  });

  it("usa o objetivo da conta quando existe, e o padrão quando não existe", () => {
    expect(montarPresetPadrao(base)).toContain(PADRAO.objetivo);
    expect(montarPresetPadrao({ ...base, objetivo: "Encher a terça e a quarta." })).toContain(
      "Encher a terça e a quarta.",
    );
  });

  it("objetivo em branco cai no padrão em vez de virar frase truncada", () => {
    expect(montarPresetPadrao({ ...base, objetivo: "   " })).toContain(PADRAO.objetivo);
  });

  it("traduz o tom escolhido", () => {
    expect(montarPresetPadrao({ ...base, tom: "profissional" })).toContain("sem gíria");
    expect(montarPresetPadrao({ ...base, tom: "descontraido" })).toContain("Fale leve");
  });

  it("traduz o uso de emoji, inclusive o proibido", () => {
    expect(montarPresetPadrao({ ...base, emoji: "nenhum" })).toContain("Não use emoji nenhum.");
    expect(montarPresetPadrao({ ...base, emoji: "normal" })).toContain("naturalidade");
  });

  it("lista só as situações de transferência escolhidas", () => {
    const texto = montarPresetPadrao({ ...base, transferirQuando: ["reclamacao"] });
    expect(texto).toContain(SITUACOES_DE_TRANSFERENCIA.reclamacao.regra);
    expect(texto).not.toContain(SITUACOES_DE_TRANSFERENCIA.pagamento.regra);
  });

  it("sem nenhuma situação escolhida, o bloco de transferência não aparece", () => {
    // A regra fixa "se o cliente pedir uma pessoa, transfira" continua no prompt
    // de todo agente; o que some é a lista configurável, não a transferência.
    expect(montarPresetPadrao({ ...base, transferirQuando: [] })).not.toContain(
      "Entregue a conversa para uma pessoa",
    );
  });

  it("não oferece como opção o que o prompt fixo já garante", () => {
    // O prompt fixo manda transferir sempre que a cliente pede uma pessoa. Se
    // isso virasse caixa de marcar, desmarcar não desligaria nada — botão que
    // mente sobre o que controla.
    expect(Object.keys(SITUACOES_DE_TRANSFERENCIA)).not.toContain("pediu_atendente");
    expect(PADRAO.transferirQuando).not.toContain("pediu_atendente" as never);
  });

  it("ignora chave de situação desconhecida em vez de escrever undefined", () => {
    // O valor vem de jsonb: uma chave antiga sobrevivendo a um deploy não pode
    // virar a palavra "undefined" no prompt.
    const texto = montarPresetPadrao({
      ...base,
      transferirQuando: ["reclamacao", "chave_que_nao_existe"] as never,
    });
    expect(texto).not.toContain("undefined");
    expect(texto).toContain(SITUACOES_DE_TRANSFERENCIA.reclamacao.regra);
  });
});

describe("chaves de transferência antigas", () => {
  it("descarta o que não existe mais em vez de travar o salvamento", () => {
    // Regressão medida: ao remover "pediu_atendente" da lista, a conta de teste
    // parou de conseguir salvar, porque o valor gravado ainda o continha.
    expect(apenasSituacoesConhecidas(["pediu_atendente", "reclamacao"])).toEqual(["reclamacao"]);
    expect(apenasSituacoesConhecidas([])).toEqual([]);
    expect(apenasSituacoesConhecidas(Object.keys(SITUACOES_DE_TRANSFERENCIA))).toHaveLength(
      Object.keys(SITUACOES_DE_TRANSFERENCIA).length,
    );
  });
});
