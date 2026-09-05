/**
 * Copiar para a área de transferência, inclusive fora de HTTPS.
 *
 * `navigator.clipboard` só existe em contexto seguro — HTTPS ou localhost. Em
 * um deploy servido por HTTP puro ele é `undefined`, e o botão de copiar falha
 * sem dizer nada: o clique acontece, nada é copiado. O caminho antigo
 * (`document.execCommand`) está depreciado, mas é o único que funciona ali, e
 * é por isso que ele continua aqui como reserva.
 *
 * Retorna se a cópia aconteceu, para a tela poder oferecer a saída manual
 * quando os dois caminhos falham.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permissão negada ou aba sem foco: ainda vale tentar o caminho antigo.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // Fora de vista, sem rolar a página; 16px evita o zoom automático do iOS.
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.fontSize = "16px";
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");

    document.body.removeChild(textarea);
    // Devolve o que a pessoa tinha selecionado antes do clique.
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return copied;
  } catch {
    return false;
  }
}
