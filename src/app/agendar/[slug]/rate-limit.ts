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

type Janela = { inicio: number; total: number; porChave: Map<string, number> };

let janela: Janela = { inicio: 0, total: 0, porChave: new Map() };

/**
 * Registra uma visita e diz se ela pode prosseguir.
 *
 * `agora` é parâmetro para o teste poder andar no tempo sem esperar um minuto
 * de verdade. A recusa NÃO incrementa contador nenhum: quem já foi barrado não
 * ganha a chance de empurrar a janela para frente insistindo.
 */
export function permitirVisita(chave: string, agora = Date.now()): boolean {
  if (agora - janela.inicio >= JANELA_MS || janela.porChave.size > MAX_CHAVES) {
    janela = { inicio: agora, total: 0, porChave: new Map() };
  }
  if (janela.total >= VISITAS_POR_MINUTO_NA_PLATAFORMA) return false;
  const usadas = janela.porChave.get(chave) ?? 0;
  if (usadas >= VISITAS_POR_MINUTO_POR_IP) return false;
  janela.porChave.set(chave, usadas + 1);
  janela.total += 1;
  return true;
}

/** Só para o teste: zera a janela entre casos. */
export function _resetarJanelaDeVisitas(): void {
  janela = { inicio: 0, total: 0, porChave: new Map() };
}
