/**
 * Arquivo de calendário do agendamento confirmado.
 *
 * Existe por um motivo comercial, não decorativo: falta é o prejuízo número um
 * de quem trabalha com hora marcada, e o lembrete que funciona é o que a
 * própria cliente coloca no calendário dela na hora em que ainda está animada.
 *
 * Montado no navegador, com o que a tela já tem em mãos — não há ida ao
 * servidor nem rota nova para isso.
 */

type Evento = {
  titulo: string;
  inicio: Date;
  duracaoMin: number;
  local: string;
  descricao: string;
};

/** RFC 5545 §3.3.11: vírgula, ponto-e-vírgula, barra e quebra de linha são especiais. */
function escapar(texto: string): string {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Forma UTC básica: 20260824T120000Z. */
function carimbo(data: Date): string {
  return `${data.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/**
 * Linhas acima de 75 octetos precisam ser dobradas, senão o Google Calendar
 * recusa o arquivo inteiro. A conta é em BYTES, não em caracteres: "Cabeleireiro"
 * cabe em 75 caracteres e estoura em 75 octetos assim que aparece um acento.
 */
function dobrar(linha: string): string {
  const bytes = new TextEncoder().encode(linha);
  if (bytes.length <= 75) return linha;
  const partes: string[] = [];
  let atual = "";
  let tamanho = 0;
  // Percorre por ponto de código para nunca partir um caractere ao meio.
  for (const caractere of linha) {
    const custo = new TextEncoder().encode(caractere).length;
    // Continuação começa com um espaço, que também conta no limite.
    const teto = partes.length === 0 ? 75 : 74;
    if (tamanho + custo > teto) {
      partes.push(atual);
      atual = "";
      tamanho = 0;
    }
    atual += caractere;
    tamanho += custo;
  }
  if (atual) partes.push(atual);
  return partes.map((parte, i) => (i === 0 ? parte : ` ${parte}`)).join("\r\n");
}

export function montarICS(evento: Evento, uid: string): string {
  const fim = new Date(evento.inicio.getTime() + evento.duracaoMin * 60_000);
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agenda de Unha//Agendamento online//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${carimbo(new Date())}`,
    `DTSTART:${carimbo(evento.inicio)}`,
    `DTEND:${carimbo(fim)}`,
    `SUMMARY:${escapar(evento.titulo)}`,
    `LOCATION:${escapar(evento.local)}`,
    `DESCRIPTION:${escapar(evento.descricao)}`,
    // Um alarme de uma hora antes: é o lembrete que evita a falta.
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT1H",
    `DESCRIPTION:${escapar(evento.titulo)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // CRLF é exigência da especificação, não preferência de estilo.
  return linhas.map(dobrar).join("\r\n");
}

/**
 * Entrega o arquivo. Blob e não `data:` porque o Safari do iPhone trata
 * `data:text/calendar` como navegação e sai da página — perdendo a tela de
 * confirmação que a cliente ainda pode querer reler.
 */
export function baixarICS(conteudo: string, nomeArquivo: string): void {
  const blob = new Blob([conteudo], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Só depois do clique: revogar na mesma volta do laço cancela o download.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
