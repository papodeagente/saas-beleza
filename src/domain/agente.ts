/**
 * Vocabulário do agente de IA, compartilhado entre servidor e tela.
 *
 * Mora aqui e não junto do preset porque o preset é `server-only`: importar de
 * lá para montar um seletor arrastaria `pg` inteiro para o pacote do navegador.
 * É a mesma regra que já vale para os rótulos de status de atendimento.
 */

export type ModoDoAgente = "padrao" | "personalizado";

export const TONS = ["profissional", "equilibrado", "descontraido"] as const;
export type Tom = (typeof TONS)[number];

export const ROTULO_DO_TOM: Record<Tom, string> = {
  profissional: "Mais profissional",
  equilibrado: "Equilibrado",
  descontraido: "Mais descontraído",
};

export const USOS_DE_EMOJI = ["nenhum", "poucos", "normal"] as const;
export type UsoDeEmoji = (typeof USOS_DE_EMOJI)[number];

export const ROTULO_DO_EMOJI: Record<UsoDeEmoji, string> = {
  nenhum: "Não usar",
  poucos: "Poucos",
  normal: "Normal",
};

/**
 * Situações de transferência. A chave vai para o banco, o rótulo para a tela e
 * a regra para o prompt — os três precisam dizer a mesma coisa, e por isso
 * moram no mesmo lugar.
 */
/**
 * Pedir para falar com uma pessoa NÃO está aqui de propósito: o prompt fixo já
 * manda transferir sempre que a cliente pede, para todo agente. Oferecer como
 * caixa de marcar seria oferecer um botão que não desliga nada.
 */
export const SITUACOES_DE_TRANSFERENCIA = {
  reclamacao: {
    rotulo: "Reclamação sobre um atendimento",
    regra: "a cliente reclamar de um atendimento ou do resultado",
  },
  pagamento: {
    rotulo: "Problema com pagamento",
    regra: "o assunto for cobrança, estorno ou problema de pagamento",
  },
  fora_do_assunto: {
    rotulo: "Assunto que não é agendamento",
    regra: "o assunto fugir de serviços, preços e agenda",
  },
  sem_informacao: {
    rotulo: "Você não encontrou a informação",
    regra: "a informação não estiver em nenhuma ferramenta nem na base de conhecimento",
  },
} as const;

export type SituacaoDeTransferencia = keyof typeof SITUACOES_DE_TRANSFERENCIA;

/**
 * Descarta chave que não existe mais, em vez de rejeitar.
 *
 * O valor vem de um jsonb gravado por uma versão anterior da tela. Quando uma
 * situação sai da lista, toda conta que a tinha marcada deixaria de conseguir
 * salvar — medido ao remover "pediu_atendente": a conta de teste travou no
 * primeiro salvamento, com o texto do Zod em inglês num toast.
 */
export function apenasSituacoesConhecidas(chaves: readonly string[]): SituacaoDeTransferencia[] {
  return chaves.filter((chave): chave is SituacaoDeTransferencia => chave in SITUACOES_DE_TRANSFERENCIA);
}

/** O que a conta recebe ao ativar a configuração padrão, antes de mexer em nada. */
export const PADRAO = {
  tom: "equilibrado" as Tom,
  emoji: "poucos" as UsoDeEmoji,
  objetivo: "Transformar conversa em horário marcado.",
  transferirQuando: [
    "reclamacao",
    "pagamento",
    "sem_informacao",
  ] as SituacaoDeTransferencia[],
};

/**
 * As permissões que a Configuração Padrão liga.
 *
 * Cancelar fica DE FORA de propósito. O pedido do produto é "orientar sobre
 * cancelamentos conforme as regras do estabelecimento", e orientar não é
 * executar: cancelamento não se desfaz, e a própria descrição da ferramenta diz
 * isso. Com a permissão desligada a agente explica a regra e passa para uma
 * pessoa. Quem quiser ligar liga, na configuração personalizada.
 *
 * Mora no domínio porque a TELA também precisa dela: depois de ativar, a aba de
 * ferramentas tem que passar a mostrar o que acabou de ser concedido, senão o
 * primeiro toque ali revoga tudo de volta.
 */
export const PERMISSOES_DO_PADRAO = {
  readCustomer: true,
  readAppointments: true,
  readServices: true,
  readAvailability: true,
  readKnowledge: true,
  createAppointment: true,
  rescheduleAppointment: true,
  cancelAppointment: false,
  updateCustomer: true,
  addNote: true,
  transferToHuman: true,
} as const;

/** Cadastro mínimo sem o qual a agente não tem o que responder. */
export type ItemDeProntidao = {
  chave: "servicos" | "profissionais" | "jornada" | "whatsapp";
  rotulo: string;
  ok: boolean;
  comoResolver: string;
  /** O verbo do link. "Cadastrar" não serve para o WhatsApp, que se conecta. */
  acao: string;
  href: string;
};

export type Prontidao = {
  prontaParaAtender: boolean;
  prontaParaResponder: boolean;
  itens: ItemDeProntidao[];
};

const TEXTO_DO_TOM: Record<Tom, string> = {
  profissional: "Trate a cliente por você, com cortesia e sem gíria. Frases inteiras, sem abreviação.",
  equilibrado: "Fale como uma recepcionista simpática: próxima, direta, sem formalidade e sem intimidade forçada.",
  descontraido: "Fale leve e próxima, como quem já conhece a cliente. Sem exagero e sem gíria que envelhece.",
};

const TEXTO_DO_EMOJI: Record<UsoDeEmoji, string> = {
  nenhum: "Não use emoji nenhum.",
  poucos: "No máximo um emoji por mensagem, e só quando ele acrescentar simpatia.",
  normal: "Emoji com naturalidade, sem enfeitar cada frase.",
};

export type ConfiguracaoPadrao = {
  tom: Tom;
  emoji: UsoDeEmoji;
  objetivo: string | null;
  transferirQuando: SituacaoDeTransferencia[];
};

/**
 * O bloco que entra no prompt do sistema quando o agente está no modo padrão.
 *
 * Entra DEPOIS das regras fixas e diz isso em voz alta. A ordem não bastaria:
 * um modelo não deduz precedência de posição, e "sempre conduza ao agendamento"
 * brigaria em silêncio com "se não souber, transfira" — as duas frases certas,
 * a combinação errada.
 */
export function montarPresetPadrao(config: ConfiguracaoPadrao): string {
  const objetivo = config.objetivo?.trim() || PADRAO.objetivo;

  const situacoes = config.transferirQuando
    .filter((chave) => chave in SITUACOES_DE_TRANSFERENCIA)
    .map((chave) => SITUACOES_DE_TRANSFERENCIA[chave].regra);

  const partes: string[] = [
    "As regras acima valem sempre. O que vem agora diz para onde levar a conversa.",
    "",
    "Seu trabalho:",
    `- Você atende num negócio de beleza e unhas. ${objetivo}`,
    "- Toda resposta leva a cliente um passo adiante. Depois de informar, ofereça o próximo passo.",
    "- Responder e parar é resposta pela metade. Dizer que custa oitenta reais está incompleto; falta perguntar se ela quer ver os horários.",
    "- Se ela disser não, aceite na hora e deixe a porta aberta. Não insista, não repita a oferta.",
    "",
    "Quando oferecer horário:",
    "- Traga de duas a quatro opções, nunca a lista inteira.",
    "- Use next_available_slots quando ela não disser uma data exata, e check_availability quando disser.",
    "- Termine perguntando qual delas serve.",
    "",
    "Quando ela quiser remarcar:",
    "- Ache o atendimento dela. Se houver mais de um, pergunte qual.",
    "- Pergunte que dia ou período seria melhor antes de consultar.",
    "- Só altere depois que ela escolher, e confirme a data e a hora novas.",
    "",
    "Quando ela hesitar:",
    "- Se achar caro, diga em uma frase o que está incluído e volte a oferecer horário. Nunca ofereça desconto por conta própria.",
    "- Se disser que vai pensar, concorde sem pressionar e ofereça mostrar os horários da semana.",
    "- Se disser que vê depois, ofereça consultar agora, deixando claro que ela não precisa confirmar nada.",
    "- Nunca invente urgência. Só diga que a agenda está apertada se a consulta mostrar isso.",
    "",
    "Como você soa:",
    `- ${TEXTO_DO_TOM[config.tom] ?? TEXTO_DO_TOM.equilibrado}`,
    `- ${TEXTO_DO_EMOJI[config.emoji] ?? TEXTO_DO_EMOJI.poucos}`,
  ];

  if (situacoes.length > 0) {
    partes.push(
      "",
      "Entregue a conversa para uma pessoa quando:",
      ...situacoes.map((regra) => `- ${regra}.`),
    );
  }

  return partes.join("\n");
}
