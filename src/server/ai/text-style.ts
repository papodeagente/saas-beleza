/**
 * Regra de estilo do agente: o texto que sai para o cliente não usa travessão,
 * meia-risca nem hífen como pontuação.
 *
 * O prompt pede isso, mas modelo ignora instrução de estilo com frequência —
 * então a garantia é determinística, aplicada no ponto de saída.
 *
 * Preserva o que é dado, não estilo: URLs, e-mails e hífen entre dígitos
 * (telefone, data, faixa de horário). Hífen entre letras vira espaço, que é
 * como se escreve no WhatsApp.
 */

const PROTECTED = /(https?:\/\/\S+|www\.\S+|wa\.me\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+)/gi;

// Área de uso privado do Unicode: não colide com nada que venha do modelo.
const OPEN = "";
const CLOSE = "";

export function stripAgentDashes(text: string): string {
  if (!text) return text;
  if (!/[—–-]/.test(text)) return text;

  const parts: string[] = [];
  let out = text.replace(PROTECTED, (match) => {
    parts.push(match);
    return `${OPEN}${parts.length - 1}${CLOSE}`;
  });

  out = out.replace(/^[ \t]*[—–-][ \t]+/gm, "• ");
  out = out.replace(/\s*[—–]+\s*/g, ", ");
  out = out.replace(/\s+-\s+/g, ", ");
  out = out.replace(/(\p{L})-(?=\p{L})/gu, "$1 ");
  out = out.replace(/(\p{L})-(?=\d)/gu, "$1 ");
  out = out.replace(/(\d)-(?=\p{L})/gu, "$1 ");

  out = out
    .replace(/,\s*,+/g, ", ")
    .replace(/([!?.]),/g, "$1")
    .replace(/,\s*([!?.])/g, "$1")
    .replace(/^\s*,\s*/gm, "")
    .replace(/[ \t]{2,}/g, " ");

  return out.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (_, i) => parts[Number(i)] ?? "");
}

/**
 * Tira todo emoji do texto.
 *
 * Existe pelo mesmo motivo de `stripAgentDashes`: o prompt pede, e o modelo
 * ignora pedido de estilo com frequência. Quando a dona escolhe "não usar
 * emoji", isso é uma decisão dela sobre como a marca dela fala, não uma
 * sugestão ao modelo, então a garantia é determinística e no ponto de saída.
 *
 * Cobre sequências inteiras, não símbolos soltos: a família de quatro pessoas é
 * um emoji unido por ZWJ, e apagar só o primeiro membro deixaria os outros três
 * na tela. O seletor de variação e os indicadores regionais de bandeira entram
 * pelo mesmo motivo.
 */
export function stripEmoji(text: string): string {
  if (!text) return text;
  return text
    .replace(/\p{RI}\p{RI}/gu, "")
    .replace(/\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "");
}

/** Saída final para o WhatsApp: sem travessão, sem markdown de título, sem sobra de espaço. */
export function formatForWhatsApp(text: string, opcoes?: { semEmoji?: boolean }): string {
  const semTravessao = stripAgentDashes(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\n{3,}/g, "\n\n");
  return (opcoes?.semEmoji ? stripEmoji(semTravessao) : semTravessao).trim();
}
