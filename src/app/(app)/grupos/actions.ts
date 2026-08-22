"use server";

import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroups,
  resetInviteCode,
  setJoinApproval,
  setOnlyAdminsEdit,
  setOnlyAdminsSend,
  updateGroupDescription,
  updateGroupName,
  updateParticipants,
  type Group,
  type GroupPage,
  type ParticipantAction,
} from "@/server/whatsapp/uazapi-groups";

/**
 * Gestão de grupos.
 *
 * Tudo aqui fala direto com a uazapi, sem espelho no banco: a fonte da verdade
 * é o WhatsApp, e um cache local só criaria divergência — alguém entra ou sai
 * pelo celular e a tela passaria a mentir.
 */

export type GroupResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function credentials() {
  const ctx = await requireSession();
  requireRole(ctx, "staff");
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) throw new Error("SEM_CONEXAO");
  return credentialsOf(connection);
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return "Não foi possível concluir.";
  if (error.message === "SEM_CONEXAO") return "Conecte o WhatsApp antes de gerenciar grupos.";
  if (error.message === "FORBIDDEN") return "Você não tem permissão para isso.";
  if (error.message.includes("401")) return "A instância recusou o token. Verifique a conexão.";
  if (error.message.includes("403")) return "O WhatsApp recusou: normalmente é falta de permissão de administrador no grupo.";
  if (error.message.includes("404")) return "Grupo não encontrado.";
  return error.message;
}

const listSchema = z.object({
  search: z.string().trim().max(80).optional(),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(60).default(30),
});

export async function listGroupsAction(input: unknown): Promise<GroupResult<GroupPage>> {
  try {
    const data = listSchema.parse(input ?? {});
    const page = await listGroups(await credentials(), {
      search: data.search,
      offset: data.offset,
      limit: data.limit,
      // Sem participantes na lista: com centenas de grupos, a carga é o que
      // decide se a tela abre em um segundo ou em vinte.
      withParticipants: false,
    });
    return { ok: true, data: page };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const jidSchema = z.string().trim().min(5).endsWith("@g.us");

export async function getGroupAction(groupJid: unknown): Promise<GroupResult<Group>> {
  try {
    const jid = jidSchema.parse(groupJid);
    const group = await getGroup(await credentials(), jid, { inviteLink: true, pendingRequests: true });
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao grupo.").max(100),
  participants: z.array(z.string().trim()).min(1, "Escolha ao menos uma pessoa.").max(256),
});

export async function createGroupAction(input: unknown): Promise<GroupResult<Group>> {
  try {
    const data = createSchema.parse(input);
    const group = await createGroup(await credentials(), data.name, data.participants);
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const participantsSchema = z.object({
  groupJid: jidSchema,
  action: z.enum(["add", "remove", "promote", "demote", "approve", "reject"]),
  participants: z.array(z.string().trim().min(3)).min(1).max(50),
});

export async function updateParticipantsAction(input: unknown): Promise<GroupResult<Group>> {
  try {
    const data = participantsSchema.parse(input);
    const creds = await credentials();
    await updateParticipants(creds, data.groupJid, data.action as ParticipantAction, data.participants);
    // Relê do WhatsApp: só assim a tela reflete quem de fato entrou ou saiu —
    // o pedido pode ser recusado por privacidade sem virar erro.
    const group = await getGroup(creds, data.groupJid, { inviteLink: true, pendingRequests: true });
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const settingsSchema = z.object({
  groupJid: jidSchema,
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  onlyAdminsSend: z.boolean().optional(),
  onlyAdminsEdit: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

export async function updateGroupAction(input: unknown): Promise<GroupResult<Group>> {
  try {
    const data = settingsSchema.parse(input);
    const creds = await credentials();

    if (data.name !== undefined) await updateGroupName(creds, data.groupJid, data.name);
    if (data.description !== undefined) await updateGroupDescription(creds, data.groupJid, data.description);
    if (data.onlyAdminsSend !== undefined) await setOnlyAdminsSend(creds, data.groupJid, data.onlyAdminsSend);
    if (data.onlyAdminsEdit !== undefined) await setOnlyAdminsEdit(creds, data.groupJid, data.onlyAdminsEdit);
    if (data.requiresApproval !== undefined) await setJoinApproval(creds, data.groupJid, data.requiresApproval);

    const group = await getGroup(creds, data.groupJid, { inviteLink: true });
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function leaveGroupAction(groupJid: unknown): Promise<GroupResult<true>> {
  try {
    const jid = jidSchema.parse(groupJid);
    await leaveGroup(await credentials(), jid);
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function resetInviteAction(groupJid: unknown): Promise<GroupResult<string | null>> {
  try {
    const jid = jidSchema.parse(groupJid);
    const creds = await credentials();
    const link = await resetInviteCode(creds, jid);
    if (link) return { ok: true, data: link };
    // Nem toda versão devolve o link novo; buscar de novo é mais confiável do
    // que mostrar vazio para quem acabou de gerar.
    const group = await getGroup(creds, jid, { inviteLink: true });
    return { ok: true, data: group.inviteLink ?? null };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const joinSchema = z.string().trim().min(4).max(200);

export async function joinGroupAction(inviteCode: unknown): Promise<GroupResult<Group>> {
  try {
    const code = joinSchema.parse(inviteCode);
    const group = await joinGroup(await credentials(), code);
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}
