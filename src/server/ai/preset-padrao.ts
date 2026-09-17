import "server-only";

/**
 * O preset mora em `@/domain/agente` porque a TELA também precisa dele: ao
 * trocar do modo padrão para o personalizado, o texto tem que aparecer na caixa
 * de instruções, senão a dona sai do padrão e fica com uma agente sem
 * comportamento nenhum e sem saber por quê.
 *
 * Este arquivo continua existindo como a porta do servidor para o preset.
 */
export { montarPresetPadrao, type ConfiguracaoPadrao } from "@/domain/agente";
