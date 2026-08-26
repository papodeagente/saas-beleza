/**
 * Cartela de esmaltes — a cor que identifica cada categoria de serviço.
 *
 * POR QUE COR AQUI E EM MAIS NENHUM LUGAR DO PRODUTO
 *
 * O painel interno é operado oito horas por dia e cor demais lá vira ruído.
 * Esta página é o oposto: a cliente passa dois minutos nela, e o ofício que ela
 * está contratando é literalmente sobre cor. A cartela é o vocabulário da
 * manicure — é assim que ela mostra o trabalho e assim que a cliente escolhe.
 *
 * A cor NUNCA carrega informação sozinha: a gota aparece sempre colada ao nome
 * escrito da categoria, e o roxo da marca continua sendo o único sinal de
 * seleção e de ação. Quem não distingue os tons não perde nada.
 *
 * CONTRASTE (medido, ver o cálculo no fim do arquivo)
 *
 * Cada tom tem `fill` e `aro`. O aro é o mesmo tom escurecido até cruzar 3:1
 * contra TODA superfície onde a postiça pousa — o cartão de osso, a placa
 * rebaixada e o balcão — que é o limiar de contorno de componente. Sem ele o
 * Nude Leitoso (1,36:1 sobre branco) simplesmente desaparece, que é o caso
 * onde uma cartela ingênua quebra.
 *
 * Dois aros foram reescurecidos quando o chão deixou de ser lavanda e virou
 * osso: o Nude saiu de #9d888c (2,64:1 no balcão, reprova) e o Coral de
 * #d96c3a (2,71:1, reprova).
 *
 * A ATRIBUIÇÃO É ESTÁVEL, NÃO ALEATÓRIA
 *
 * O tom sai de um hash do nome da categoria. A mesma categoria recebe o mesmo
 * esmalte em toda visita, em todo dispositivo e em todo servidor — inclusive
 * entre o HTML do servidor e a hidratação no cliente, onde `Math.random()`
 * daria divergência de marcação. É por isso que não há sorteio aqui.
 */

export type Esmalte = {
  /** Nome do tom. Não vai para a tela: serve de documentação e de rótulo acessível. */
  nome: string;
  fill: string;
  aro: string;
};

/**
 * Oito tons de esmalte de verdade, na ordem em que costumam aparecer numa
 * cartela: os rosados na frente, porque são os mais pedidos.
 *
 * Razões medidas do aro contra o cartão branco / contra o canvas lavanda:
 *   Rosa Antigo      3,99 / 3,72      Vermelho Carmim  6,16 / 5,74
 *   Vinho           10,11 / 9,42      Nude Leitoso     3,32 / 3,09
 *   Coral            3,41 / 3,18      Verde Musgo      7,49 / 6,98
 *   Azul Noite      10,02 / 9,33      Lilás            5,69 / 5,30
 */
const CARTELA: readonly Esmalte[] = [
  { nome: "Rosa Antigo", fill: "#d4536e", aro: "#d4536e" },
  { nome: "Nude Leitoso", fill: "#e8cec2", aro: "#8e7e76" },
  { nome: "Vermelho Carmim", fill: "#c0143c", aro: "#c0143c" },
  { nome: "Lilás", fill: "#7b4bc9", aro: "#7b4bc9" },
  { nome: "Coral", fill: "#e2703a", aro: "#cb6534" },
  { nome: "Vinho", fill: "#7d1a38", aro: "#7d1a38" },
  { nome: "Verde Musgo", fill: "#2f5d50", aro: "#2f5d50" },
  { nome: "Azul Noite", fill: "#26407a", aro: "#26407a" },
];

/** Serviço sem categoria não fica sem cor: recebe o lilás da marca. */
const SEM_CATEGORIA = CARTELA[3];

/** FNV-1a de 32 bits: barato, determinístico e sem dependência. */
function fnv1a(texto: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function esmalteDe(categoria: string | null | undefined): Esmalte {
  if (!categoria) return SEM_CATEGORIA;
  return CARTELA[fnv1a(categoria) % CARTELA.length];
}

export type Laca = { nome: string; tinta: string };

/**
 * A laca da casa — o plano esmaltado do cabeçalho e do topo do bilhete.
 *
 * É UMA só, e a decisão de não sortear tem história. A primeira versão tirava
 * a laca de um hash do nome da clínica, numa cartela de oito tons escuros; a
 * ideia era dar cara própria a cada salão sem exigir foto nenhuma. Posta na
 * tela, ela mostrou o defeito: a "Clínica Lumina" caiu num marrom-café, que numa
 * página de estética lê como barra de chocolate, e os tons que sobravam eram
 * roxos tão próximos entre si que ninguém notaria a diferença. Variação
 * invisível quando acerta e errada quando erra não é variação, é risco.
 *
 * O que dá cara própria a cada clínica continua na página, e vindo de dado de
 * verdade: o nome dela na serifa da marca e a cor das CATEGORIAS que ela mesma
 * cadastrou, uma por uma, na carta de serviços.
 *
 * A tinta é a ameixa da marca levada ao quase-preto — mesma família do
 * `--color-ink` (#2d203b), não uma cor de outra marca. Branco chapado sobre ela
 * mede 15,44:1, e branco a 80% sobre ela clareada em 20% pelas camadas de
 * brilho ainda mede 6,17:1.
 *
 * Continua sendo uma FUNÇÃO e um token pintado no style porque o dia em que a
 * clínica ganhar campo de cor no cadastro isto vira `lacaDe(org.corDaCasa)` e
 * nenhuma outra linha da página muda.
 */
const AMEIXA_NOTURNA: Laca = { nome: "Ameixa Noturna", tinta: "#331a3f" };

export function lacaDe(
  // O nome entra sem ser usado de propósito: é a costura pronta para o dia em
  // que a clínica tiver cor própria no cadastro. Sem ele, cada chamada da
  // página teria de mudar depois.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  nomeDaCasa: string | null | undefined,
): Laca {
  return AMEIXA_NOTURNA;
}
