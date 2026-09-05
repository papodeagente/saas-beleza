/** (84) 99123-4518 — telefone brasileiro sempre legível na interface. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value;
}

/** Somente dígitos — o formato usado para armazenar e comparar. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}
