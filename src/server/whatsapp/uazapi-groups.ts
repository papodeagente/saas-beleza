import "server-only";
import { asArray, asNumber, firstString, get, type Json } from "@/server/whatsapp/json";
import { digitsOnly } from "@/server/whatsapp/phone";
import { uazapiRequest, type UazapiCredentials } from "@/server/whatsapp/uazapi-client";

/**
 * Grupos do WhatsApp.
 *
 * A uazapi devolve os campos em PascalCase e mistura duas identidades para a
 * mesma pessoa: `JID` (que em grupos costuma ser a identidade opaca `@lid`) e
 * `PhoneNumber`. Este módulo normaliza os dois: o telefone é o que a atendente
 * reconhece, mas as ações precisam do JID que o grupo usa.
 */

export type GroupParticipant = {
  jid: string;
  phone: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

export type Group = {
  jid: string;
  name: string;
  description: string | null;
  ownerPhone: string | null;
  participants: GroupParticipant[];
  participantCount: number;
  /** Só administradores enviam mensagem. */
  onlyAdminsSend: boolean;
  /** Só administradores editam nome, foto e descrição. */
  onlyAdminsEdit: boolean;
  requiresApproval: boolean;
  createdAt: string | null;
  inviteLink?: string | null;
};

function trueLike(value: Json): boolean {
  return value === true || value === 1 || (typeof value === "string" && ["true", "1", "yes"].includes(value.toLowerCase()));
}

function normalizeParticipant(raw: Json): GroupParticipant {
  const phoneRaw = firstString(get(raw, "PhoneNumber"), get(raw, "phoneNumber"));
  const phone = digitsOnly(phoneRaw.split("@")[0] ?? "");
  return {
    jid: firstString(get(raw, "JID"), get(raw, "jid")),
    phone: phone || null,
    displayName: firstString(get(raw, "DisplayName"), get(raw, "displayName")).trim() || null,
    isAdmin: trueLike(get(raw, "IsAdmin") ?? get(raw, "isAdmin")),
    isSuperAdmin: trueLike(get(raw, "IsSuperAdmin") ?? get(raw, "isSuperAdmin")),
  };
}

export function normalizeGroup(raw: Json): Group {
  const participants = asArray(get(raw, "Participants") ?? get(raw, "participants")).map(normalizeParticipant);
  const ownerRaw = firstString(get(raw, "OwnerPN"), get(raw, "OwnerJID"));
  return {
    jid: firstString(get(raw, "JID"), get(raw, "jid")),
    name: firstString(get(raw, "Name"), get(raw, "name")).trim() || "Grupo sem nome",
    description: firstString(get(raw, "Topic"), get(raw, "topic")).trim() || null,
    ownerPhone: digitsOnly(ownerRaw.split("@")[0] ?? "") || null,
    participants,
    // `ParticipantCount` volta zerado com frequência; a lista é a fonte confiável.
    participantCount: participants.length || (asNumber(get(raw, "ParticipantCount")) ?? 0),
    onlyAdminsSend: trueLike(get(raw, "IsAnnounce") ?? get(raw, "isAnnounce")),
    onlyAdminsEdit: trueLike(get(raw, "IsLocked") ?? get(raw, "isLocked")),
    requiresApproval: trueLike(get(raw, "IsJoinApprovalRequired") ?? get(raw, "isJoinApprovalRequired")),
    createdAt: firstString(get(raw, "GroupCreated"), get(raw, "groupCreated")) || null,
    inviteLink: firstString(get(raw, "InviteLink"), get(raw, "inviteLink")) || null,
  };
}

export type GroupPage = { groups: Group[]; total: number; limit: number; offset: number };

/**
 * Lista paginada. Uma conta com centenas de grupos torna a paginação
 * obrigatória, e `noParticipants` corta a maior parte do peso quando só
 * precisamos dos nomes.
 */
export async function listGroups(
  creds: UazapiCredentials,
  params: { limit?: number; offset?: number; search?: string; withParticipants?: boolean; force?: boolean } = {},
): Promise<GroupPage> {
  const limit = params.limit ?? 30;
  const offset = params.offset ?? 0;
  const resp = await uazapiRequest(creds, "POST", "/group/list", {
    limit,
    offset,
    search: params.search || undefined,
    noParticipants: params.withParticipants ? false : true,
    force: params.force ?? false,
  });

  const raw = Array.isArray(resp) ? resp : asArray(get(resp, "groups"));
  return {
    groups: raw.map(normalizeGroup),
    total: asNumber(get(resp, "pagination", "totalRecords")) ?? raw.length,
    limit: asNumber(get(resp, "pagination", "limit")) ?? limit,
    offset: asNumber(get(resp, "pagination", "offset")) ?? offset,
  };
}

export async function getGroup(
  creds: UazapiCredentials,
  groupJid: string,
  opts: { inviteLink?: boolean; pendingRequests?: boolean } = {},
): Promise<Group> {
  const resp = await uazapiRequest(creds, "POST", "/group/info", {
    groupjid: groupJid,
    getInviteLink: opts.inviteLink ?? false,
    getRequestsParticipants: opts.pendingRequests ?? false,
    force: true,
  });
  const raw = get(resp, "group") ?? resp;
  const group = normalizeGroup(raw);
  const link = firstString(get(raw, "InviteLink"), get(raw, "inviteLink"), get(resp, "InviteLink"), get(resp, "inviteLink"));
  return { ...group, inviteLink: link || null };
}

export async function createGroup(
  creds: UazapiCredentials,
  name: string,
  participants: string[],
): Promise<Group> {
  const resp = await uazapiRequest(creds, "POST", "/group/create", {
    name,
    participants: participants.map((p) => digitsOnly(p)).filter(Boolean),
  });
  return normalizeGroup(get(resp, "group") ?? resp);
}

export type ParticipantAction = "add" | "remove" | "promote" | "demote" | "approve" | "reject";

export async function updateParticipants(
  creds: UazapiCredentials,
  groupJid: string,
  action: ParticipantAction,
  participants: string[],
): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateParticipants", {
    groupjid: groupJid,
    action,
    // Remover e promover usam o JID que o grupo conhece; adicionar usa o
    // telefone. Passar como veio cobre os dois casos.
    participants,
  });
}

export async function updateGroupName(creds: UazapiCredentials, groupJid: string, name: string): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateName", { groupjid: groupJid, name });
}

export async function updateGroupDescription(
  creds: UazapiCredentials,
  groupJid: string,
  description: string,
): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateDescription", { groupjid: groupJid, description });
}

export async function updateGroupImage(creds: UazapiCredentials, groupJid: string, image: string): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateImage", { groupjid: groupJid, image });
}

/** true = só administradores enviam mensagem no grupo. */
export async function setOnlyAdminsSend(creds: UazapiCredentials, groupJid: string, value: boolean): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateAnnounce", { groupjid: groupJid, announce: value });
}

/** true = só administradores editam nome, foto e descrição. */
export async function setOnlyAdminsEdit(creds: UazapiCredentials, groupJid: string, value: boolean): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateLocked", { groupjid: groupJid, locked: value });
}

export async function setJoinApproval(creds: UazapiCredentials, groupJid: string, value: boolean): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/updateJoinApproval", {
    groupjid: groupJid,
    IsJoinApprovalRequired: value,
  });
}

export async function leaveGroup(creds: UazapiCredentials, groupJid: string): Promise<void> {
  await uazapiRequest(creds, "POST", "/group/leave", { groupjid: groupJid });
}

/** Invalida o link atual e devolve o novo. Quem tinha o antigo perde o acesso. */
export async function resetInviteCode(creds: UazapiCredentials, groupJid: string): Promise<string | null> {
  const resp = await uazapiRequest(creds, "POST", "/group/resetInviteCode", { groupjid: groupJid });
  return firstString(get(resp, "inviteLink"), get(resp, "InviteLink"), get(resp, "link")) || null;
}

export async function inviteInfo(creds: UazapiCredentials, inviteCode: string): Promise<Group> {
  const resp = await uazapiRequest(creds, "POST", "/group/inviteInfo", { invitecode: inviteCode });
  return normalizeGroup(get(resp, "group") ?? resp);
}

export async function joinGroup(creds: UazapiCredentials, inviteCode: string): Promise<Group> {
  const resp = await uazapiRequest(creds, "POST", "/group/join", { invitecode: inviteCode });
  return normalizeGroup(get(resp, "group") ?? resp);
}
