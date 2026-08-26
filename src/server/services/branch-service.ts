import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, branches } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { municipioPorCodigo, municipioPorNome } from "./location-service";

/**
 * Unidades — o endereço do salão.
 *
 * A lógica morava solta no `actions.ts` da tela e só sabia CRIAR: não existia
 * `updateBranchAction` em lugar nenhum do produto. Na prática, uma clínica que
 * digitasse o endereço errado no cadastro convivia com ele para sempre.
 *
 * Isso deixou de ser um incômodo e virou bloqueio quando o endereço passou a
 * decidir se o salão aparece na busca por cidade: dado que não pode ser
 * corrigido nasce podre e permanece.
 *
 * A GUARDA MULTI-TENANT É O PRÓPRIO `where`, como em `catalog-service`: todo
 * update casa `id` E `organizationId`, e a ausência de linha devolvida é o que
 * denuncia a tentativa.
 */

export class BranchError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BranchInput = {
  name: string;
  /** Endereço em uma linha. Continua existindo: é o que sai no bilhete. */
  address: string | null;
  phone: string | null;
  active?: boolean;
  /** Endereço estruturado. Tudo opcional — a maioria da base não tem nada disto. */
  postalCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  uf?: string | null;
  ibgeCode?: number | null;
};

export type BranchRow = typeof branches.$inferSelect;

export async function listBranches(ctx: TenantContext): Promise<BranchRow[]> {
  return db
    .select()
    .from(branches)
    .where(eq(branches.organizationId, ctx.organizationId))
    .orderBy(asc(branches.name));
}

export async function getBranch(ctx: TenantContext, branchId: number): Promise<BranchRow | null> {
  const [linha] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.organizationId, ctx.organizationId)))
    .limit(1);
  return linha ?? null;
}

/**
 * Resolve a coordenada a partir do que a clínica informou.
 *
 * A escada é deliberada e a precisão sai JUNTO com a coordenada, nunca
 * separada dela — quem grava lat/lng sem gravar de onde ela veio entrega ao
 * resto do produto um número que parece exato e não é.
 *
 * Hoje só existe um degrau real (o centro do município), porque o ViaCEP
 * normaliza endereço e não devolve coordenada. Os degraus finos — rua, porta —
 * entram no dia em que houver geocodificador ou pino no mapa, e este é o único
 * lugar que muda.
 */
async function resolverGeo(input: BranchInput): Promise<{
  lat: number | null;
  lng: number | null;
  ibgeCode: number | null;
  geoSource: BranchRow["geoSource"];
  geoPrecision: BranchRow["geoPrecision"];
  geocodedAt: Date | null;
}> {
  const municipio =
    (input.ibgeCode ? await municipioPorCodigo(input.ibgeCode) : null) ??
    (input.city && input.uf ? await municipioPorNome(input.city, input.uf) : null);

  if (!municipio) {
    return {
      lat: null,
      lng: null,
      ibgeCode: input.ibgeCode ?? null,
      geoSource: null,
      geoPrecision: "nenhuma",
      geocodedAt: null,
    };
  }

  return {
    lat: municipio.lat,
    lng: municipio.lng,
    ibgeCode: municipio.ibgeCode,
    geoSource: input.postalCode ? "cep" : "municipio",
    geoPrecision: "cidade",
    geocodedAt: new Date(),
  };
}

function camposDaUnidade(input: BranchInput, geo: Awaited<ReturnType<typeof resolverGeo>>) {
  return {
    name: input.name.trim(),
    address: input.address?.trim() || null,
    phone: input.phone || null,
    ...(input.active === undefined ? {} : { active: input.active }),
    postalCode: input.postalCode || null,
    street: input.street?.trim() || null,
    number: input.number?.trim() || null,
    complement: input.complement?.trim() || null,
    district: input.district?.trim() || null,
    city: input.city?.trim() || null,
    uf: input.uf?.trim().toUpperCase() || null,
    ...geo,
  };
}

/**
 * O rastro. Mesma razão de `catalog-service`: `audit_logs` existe desde a
 * primeira migração e quase nada escrevia nela. Endereço passa a decidir
 * visibilidade pública, então "quem mudou a cidade da unidade" vira pergunta.
 */
async function registrar(
  tx: Tx,
  ctx: TenantContext,
  branchId: number,
  acao: string,
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown>,
): Promise<void> {
  const mudou = antes
    ? Object.keys(depois).filter((chave) => !Object.is(antes[chave], depois[chave]))
    : Object.keys(depois);
  if (mudou.length === 0) return;
  await tx.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorType: "user",
    actorId: ctx.userId,
    entity: "branch",
    entityId: branchId,
    action: acao,
    before: antes ? Object.fromEntries(mudou.map((c) => [c, antes[c]])) : null,
    after: Object.fromEntries(mudou.map((c) => [c, depois[c]])),
  });
}

/**
 * Só o que interessa ao rastro — o objeto inteiro vira um diário que ninguém lê.
 *
 * Aceita tanto os campos que vão ser gravados quanto a linha que veio do banco,
 * porque os dois lados do "antes e depois" precisam ser recortados pela MESMA
 * régua: recortes diferentes fariam `registrar` acusar mudança em campo que não
 * mudou.
 */
function paraRastro(
  campos: Pick<
    BranchRow,
    "name" | "address" | "phone" | "city" | "uf" | "postalCode" | "lat" | "lng" | "geoPrecision"
  >,
): Record<string, unknown> {
  return {
    name: campos.name,
    address: campos.address,
    phone: campos.phone,
    city: campos.city,
    uf: campos.uf,
    postalCode: campos.postalCode,
    lat: campos.lat,
    lng: campos.lng,
    geoPrecision: campos.geoPrecision,
  };
}

export async function createBranch(ctx: TenantContext, input: BranchInput): Promise<number> {
  const geo = await resolverGeo(input);
  const campos = camposDaUnidade(input, geo);
  return db.transaction(async (tx) => {
    const [criada] = await tx
      .insert(branches)
      .values({ organizationId: ctx.organizationId, ...campos })
      .returning({ id: branches.id });
    await registrar(tx, ctx, criada.id, "created", null, paraRastro(campos));
    return criada.id;
  });
}

export async function updateBranch(
  ctx: TenantContext,
  branchId: number,
  input: BranchInput,
): Promise<void> {
  const geo = await resolverGeo(input);
  const campos = camposDaUnidade(input, geo);
  await db.transaction(async (tx) => {
    // O estado anterior serve ao rastro, NÃO à guarda de tenant: quem guarda é
    // o `where` do update, logo abaixo.
    const [antes] = await tx
      .select()
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, ctx.organizationId)))
      .limit(1);

    const [atualizada] = await tx
      .update(branches)
      .set(campos)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, ctx.organizationId)))
      .returning({ id: branches.id });
    if (!atualizada) throw new BranchError("Unidade não encontrada.", "NAO_ENCONTRADA");

    await registrar(tx, ctx, branchId, "updated", antes ? paraRastro(antes) : null, paraRastro(campos));
  });
}

/**
 * Desativar em vez de apagar.
 *
 * A unidade é referenciada por agendamento, jornada de profissional e recurso.
 * Apagar levaria o histórico junto; `active = false` some da tela pública e do
 * diretório e preserva o passado.
 */
export async function setBranchActive(
  ctx: TenantContext,
  branchId: number,
  active: boolean,
): Promise<void> {
  const [atualizada] = await db
    .update(branches)
    .set({ active })
    .where(and(eq(branches.id, branchId), eq(branches.organizationId, ctx.organizationId)))
    .returning({ id: branches.id });
  if (!atualizada) throw new BranchError("Unidade não encontrada.", "NAO_ENCONTRADA");
}
