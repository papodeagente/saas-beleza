/**
 * Telefone e JID.
 *
 * O WhatsApp identifica uma conversa pelo JID, não pelo telefone: `<num>@s.whatsapp.net`
 * para pessoa, `<id>@g.us` para grupo e `<id>@lid` para a identidade opaca que o
 * WhatsApp passou a usar em alguns contatos. Só o primeiro formato tem telefone
 * dentro; tratar LID como número foi a origem de conversas duplicadas no
 * entur-os-crm, então aqui o JID é sempre a chave e o telefone é derivado.
 */

const LID_MIN_DIGITS = 15;

export function digitsOnly(value: string): string {
  return (value || "").replace(/\D/g, "");
}

/** Um LID é longo demais para ser telefone — E.164 vai até 15 dígitos. */
export function isLikelyLid(digits: string): boolean {
  return digits.length >= LID_MIN_DIGITS;
}

export function isGroupJid(jid: string): boolean {
  return (jid || "").includes("@g.us");
}

export function isLidJid(jid: string): boolean {
  return (jid || "").includes("@lid");
}

/** Telefone de um JID, ou null quando o JID não carrega um (grupo, LID). */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  if (isGroupJid(jid) || isLidJid(jid)) return null;
  const digits = digitsOnly(jid.split("@")[0] ?? "");
  if (!digits || isLikelyLid(digits)) return null;
  return digits;
}

export function jidFromPhone(phone: string): string {
  return `${digitsOnly(phone)}@s.whatsapp.net`;
}

/**
 * Forma canônica para comparar telefones brasileiros.
 *
 * Celular no Brasil ganhou o nono dígito, mas o WhatsApp devolve os dois
 * formatos dependendo de onde o número foi salvo. Sem canonizar, o mesmo
 * cliente entra duas vezes na base.
 */
export function canonicalBrPhone(raw: string | null | undefined): string | null {
  let d = digitsOnly(raw ?? "");
  if (!d) return null;
  if (isLikelyLid(d)) return null;
  if (d.startsWith("00")) d = d.slice(2);
  // Sem DDI: assume Brasil.
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55")) return d; // estrangeiro: guarda como veio
  const rest = d.slice(2);
  if (rest.length === 10) {
    // Fixo (2 a 5 no primeiro dígito) fica como está; celular antigo ganha o 9.
    const ddd = rest.slice(0, 2);
    const number = rest.slice(2);
    if (/^[6-9]/.test(number)) return `55${ddd}9${number}`;
    return d;
  }
  return d;
}

/** (11) 98765-4321 — só para exibição. */
export function formatBrPhone(raw: string | null | undefined): string {
  const d = digitsOnly(raw ?? "");
  if (!d) return "";
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw ?? "";
}
