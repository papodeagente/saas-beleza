import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, customers } from "@/db/schema";
import { canonicalBrPhone, formatBrPhone } from "@/server/whatsapp/phone";

/**
 * Encontra (ou cria) a conversa de um JID, e o cliente por trás dela.
 *
 * A chave da conversa é o JID, nunca o telefone: é o único identificador que o
 * WhatsApp garante. O telefone serve para ligar a conversa a um cliente que já
 * existe na base, e por isso é comparado na forma canônica — o mesmo celular
 * chega ora com o nono dígito, ora sem, e comparar cru duplica cadastro.
 */

export type ResolveInput = {
  organizationId: number;
  connectionId: number;
  remoteJid: string;
  phone: string | null;
  contactName: string | null;
  isGroup: boolean;
};

export type ResolvedConversation = {
  conversationId: number;
  customerId: number | null;
  created: boolean;
};

/**
 * Nome vindo do WhatsApp só preenche o cadastro enquanto ninguém o editou.
 * Um nome digitado por uma atendente vale mais do que o apelido que o cliente
 * pôs no próprio perfil, então nunca é sobrescrito.
 */
function isPlaceholderName(name: string, phone: string | null): boolean {
  if (!name.trim()) return true;
  if (!phone) return false;
  const digits = name.replace(/\D/g, "");
  return digits.length >= 8 && digits === phone.replace(/\D/g, "");
}

async function resolveCustomer(
  organizationId: number,
  phone: string | null,
  contactName: string | null,
): Promise<number | null> {
  if (!phone) return null;
  const canonical = canonicalBrPhone(phone);
  if (!canonical) return null;

  const [existing] = await db
    .select({ id: customers.id, name: customers.name, source: customers.source })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.phone, canonical)))
    .limit(1);

  if (existing) {
    if (contactName && existing.source === "whatsapp" && isPlaceholderName(existing.name, canonical)) {
      await db.update(customers).set({ name: contactName }).where(eq(customers.id, existing.id));
    }
    return existing.id;
  }

  const [created] = await db
    .insert(customers)
    .values({
      organizationId,
      name: contactName?.trim() || formatBrPhone(canonical) || canonical,
      phone: canonical,
      source: "whatsapp",
    })
    .returning({ id: customers.id });
  return created?.id ?? null;
}

export async function resolveConversation(input: ResolveInput): Promise<ResolvedConversation> {
  const { organizationId, connectionId, remoteJid, contactName, isGroup } = input;
  const phone = input.phone ? canonicalBrPhone(input.phone) : null;

  const [existing] = await db
    .select({ id: conversations.id, customerId: conversations.customerId, contactName: conversations.contactName })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.remoteJid, remoteJid)))
    .limit(1);

  if (existing) {
    const patch: Partial<typeof conversations.$inferInsert> = {};
    if (contactName && contactName !== existing.contactName) patch.contactName = contactName;
    // Conversa órfã (aberta antes de o cliente existir) ganha o vínculo assim
    // que o cadastro aparece.
    let customerId = existing.customerId;
    if (!customerId && !isGroup) {
      customerId = await resolveCustomer(organizationId, phone, contactName);
      if (customerId) patch.customerId = customerId;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(conversations).set(patch).where(eq(conversations.id, existing.id));
    }
    return { conversationId: existing.id, customerId, created: false };
  }

  /**
   * Mesmo telefone, JID diferente.
   *
   * O WhatsApp identifica um número brasileiro ora com o nono dígito, ora sem —
   * quem escolhe é ele, e a escolha muda conforme como o contato foi salvo. Sem
   * esta busca, a resposta do cliente abre uma segunda conversa e o histórico
   * se parte em duas: uma com o que enviamos, outra com o que ele respondeu.
   */
  if (!isGroup && phone) {
    const [byPhone] = await db
      .select({ id: conversations.id, customerId: conversations.customerId, remoteJid: conversations.remoteJid })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.phone, phone),
          eq(conversations.isGroup, false),
        ),
      )
      .orderBy(asc(conversations.id))
      .limit(1);

    if (byPhone) {
      // Passa a usar o JID que o WhatsApp está usando agora: é para ele que o
      // envio precisa ir.
      await db
        .update(conversations)
        .set({ remoteJid, connectionId, ...(contactName ? { contactName } : {}) })
        .where(eq(conversations.id, byPhone.id));
      return { conversationId: byPhone.id, customerId: byPhone.customerId, created: false };
    }
  }

  const customerId = isGroup ? null : await resolveCustomer(organizationId, phone, contactName);

  // Uma conversa criada por outro caminho (importação, cadastro manual) ainda
  // não tem JID. Adotá-la evita a segunda conversa para o mesmo cliente.
  if (customerId) {
    const [orphan] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.customerId, customerId),
          isNull(conversations.remoteJid),
        ),
      )
      .limit(1);
    if (orphan) {
      await db
        .update(conversations)
        .set({ remoteJid, connectionId, phone, contactName, isGroup })
        .where(eq(conversations.id, orphan.id));
      return { conversationId: orphan.id, customerId, created: false };
    }
  }

  try {
    const [created] = await db
      .insert(conversations)
      .values({
        organizationId,
        connectionId,
        customerId,
        remoteJid,
        phone,
        isGroup,
        contactName,
        channel: "whatsapp",
        controlledBy: "waiting",
        status: "open",
      })
      .returning({ id: conversations.id });
    return { conversationId: created.id, customerId, created: true };
  } catch (error) {
    // Duas mensagens do mesmo contato chegam juntas e correm para criar a
    // conversa; o índice único resolve o empate e aqui só relemos a vencedora.
    const [row] = await db
      .select({ id: conversations.id, customerId: conversations.customerId })
      .from(conversations)
      .where(and(eq(conversations.organizationId, organizationId), eq(conversations.remoteJid, remoteJid)))
      .limit(1);
    if (row) return { conversationId: row.id, customerId: row.customerId, created: false };
    throw error;
  }
}

/** Marca a conversa como lida para o inbox (não mexe no WhatsApp do cliente). */
export async function clearUnread(organizationId: number, conversationId: number): Promise<void> {
  await db
    .update(conversations)
    .set({ unreadCount: 0 })
    // `gt(unreadCount, 0)` não é microtimização: sem ele, a leitura periódica
    // do inbox gravava uma versão nova da linha a cada dez segundos por aba
    // aberta, sem mudar nada — só trabalho para o autovacuum.
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        gt(conversations.unreadCount, 0),
      ),
    );
}

export const _internals = { isPlaceholderName, resolveCustomer, sqlHelper: sql };
