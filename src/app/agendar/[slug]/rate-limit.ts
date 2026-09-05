/**
 * Limite de vazão da página pública de agendamento.
 *
 * A `trackBookingAccessAction` é uma escrita no banco que qualquer pessoa da
 * internet dispara, sem sessão e sem custo: basta abrir `/agendar/<slug>` com um
 * `visitorToken` novo. O `onConflictDoNothing` só evita a linha REPETIDA do
 * mesmo navegador no mesmo dia — quem sorteia um UUID a cada requisição escreve
 * à vontade. É um amplificador de escrita, e o freio tem de estar antes dela.
 *
 * Mesma estrutura de camadas do autocadastro (`src/server/services/signup.ts`):
 * limite por endereço mais teto da plataforma inteira, porque limite por IP
 * sozinho não segura botnet — cem endereços com nove requisições cada passam
 * ilesos pelo limite individual.
 *
 * A DIFERENÇA deliberada em relação ao signup é onde a contagem mora: lá ela é
 * uma tabela, aqui é memória do processo. Contar em tabela significaria uma
 * escrita para limitar uma escrita — o próprio amplificador que se quer fechar.
 * O preço é conhecido e aceito: com N réplicas o teto efetivo é N vezes maior.
 * Continua sendo a diferença entre "dez por minuto por réplica" e "ilimitado",
 * que é a única que importa aqui. Contagem exata exigiria Redis, e essa conta
 * (mais uma dependência no caminho crítico da página pública) não se paga para
 * proteger uma métrica de funil.
 */

/** Requisições por minuto do mesmo endereço para a mesma agenda. */
export const VISITAS_POR_MINUTO_POR_IP = 10;
/** Teto de toda a plataforma por minuto. Segura quem troca de endereço a cada chamada. */
export const VISITAS_POR_MINUTO_NA_PLATAFORMA = 600;
const JANELA_MS = 60_000;

/**
 * Guarda-chuva contra vazamento de memória: um ataque com IP diferente a cada
 * requisição criaria uma chave nova toda vez. Ao encostar no teto a janela é
 * descartada inteira — perder a contagem de um minuto é irrelevante perto de
 * segurar o mapa crescendo sem fim.
 */
const MAX_CHAVES = 20_000;

/**
 * As consultas de disponibilidade custam MUITO mais que uma visita, e até agora
 * não tinham freio nenhum.
 *
 * A conta, medida em `availability-service.ts`: `getAvailableSlots` faz seis
 * consultas ao banco. `publicAvailableDaysAction` chama uma por data e aceita
 * até 31 — a tela pede 21. Ou seja, UM toque em "escolher serviço" dispara
 * ~126 consultas concorrentes contra um pool de 10 conexões
 * (`src/db/index.ts`). Três visitantes simultâneos e mal-intencionados
 * derrubam o banco do produto inteiro sem precisar de botnet.
 *
 * Por isso o teto de consulta é mais apertado que o de visita, e o de
 * agendamento — que ESCREVE — é o mais apertado dos três.
 */
export const CONSULTAS_POR_MINUTO_POR_IP = 20;
export const CONSULTAS_POR_MINUTO_NA_PLATAFORMA = 400;
export const AGENDAMENTOS_POR_MINUTO_POR_IP = 5;
export const AGENDAMENTOS_POR_MINUTO_NA_PLATAFORMA = 120;

type Janela = { inicio: number; total: number; porChave: Map<string, number> };
type Balde = "visita" | "consulta" | "agendamento";

const LIMITES: Record<Balde, { porChave: number; naPlataforma: number }> = {
  visita: { porChave: VISITAS_POR_MINUTO_POR_IP, naPlataforma: VISITAS_POR_MINUTO_NA_PLATAFORMA },
  consulta: {
    porChave: CONSULTAS_POR_MINUTO_POR_IP,
    naPlataforma: CONSULTAS_POR_MINUTO_NA_PLATAFORMA,
  },
  agendamento: {
    porChave: AGENDAMENTOS_POR_MINUTO_POR_IP,
    naPlataforma: AGENDAMENTOS_POR_MINUTO_NA_PLATAFORMA,
  },
};

/**
 * Um balde por tipo de ação, e não um só compartilhado: quem está navegando
 * muito não pode gastar a cota de quem está tentando fechar um agendamento.
 */
const janelas = new Map<Balde, Janela>();

function nova(agora: number): Janela {
  return { inicio: agora, total: 0, porChave: new Map() };
}

function permitir(balde: Balde, chave: string, agora: number): boolean {
  let janela = janelas.get(balde);
  if (!janela || agora - janela.inicio >= JANELA_MS || janela.porChave.size > MAX_CHAVES) {
    janela = nova(agora);
    janelas.set(balde, janela);
  }
  const limite = LIMITES[balde];
  if (janela.total >= limite.naPlataforma) return false;
  const usadas = janela.porChave.get(chave) ?? 0;
  if (usadas >= limite.porChave) return false;
  janela.porChave.set(chave, usadas + 1);
  janela.total += 1;
  return true;
}

/**
 * Registra uma visita e diz se ela pode prosseguir.
 *
 * `agora` é parâmetro para o teste poder andar no tempo sem esperar um minuto
 * de verdade. A recusa NÃO incrementa contador nenhum: quem já foi barrado não
 * ganha a chance de empurrar a janela para frente insistindo.
 */
export function permitirVisita(chave: string, agora = Date.now()): boolean {
  return permitir("visita", chave, agora);
}

/** Leitura de dias livres ou de horários. Cara: até 126 consultas por chamada. */
export function permitirConsulta(chave: string, agora = Date.now()): boolean {
  return permitir("consulta", chave, agora);
}

/** Tentativa de fechar um agendamento. É escrita, e o teto é o mais baixo. */
export function permitirAgendamento(chave: string, agora = Date.now()): boolean {
  return permitir("agendamento", chave, agora);
}

/** Só para o teste: zera as janelas entre casos. */
export function _resetarJanelaDeVisitas(): void {
  janelas.clear();
}
