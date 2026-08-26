"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  CatalogError,
  createProduct,
  createService,
  futurosDoServico,
  setProductActive,
  setServiceActive,
  updateProduct,
  updateService,
} from "@/server/services/catalog-service";

export type CatalogResult = { ok: true } | { ok: false; error: string; field?: string };

/**
 * Erro de validação vira frase em português, sempre.
 *
 * O `issue.message` cru do zod chega em inglês quando a regra não tem mensagem
 * própria — "Invalid input: expected number, received NaN" apareceu na gaveta,
 * em vermelho, para quem só queria reajustar um preço. Cada campo tem nome de
 * gente, e o que não tiver cai numa frase que ao menos diz onde olhar.
 */
const NOME_DO_CAMPO: Record<string, string> = {
  name: "o nome",
  categoryName: "a categoria",
  description: "a descrição",
  durationMin: "a duração",
  priceCents: "o preço",
  costCents: "o custo",
  commissionPct: "a comissão",
  returnIntervalDays: "o retorno ideal",
  requiredResourceType: "o recurso exclusivo",
  professionalIds: "os profissionais",
  sku: "o SKU",
  stockQty: "o estoque",
};

function invalid(parsed: z.ZodSafeParseError<unknown>): CatalogResult {
  const issue = parsed.error.issues[0];
  const campo = String(issue.path[0] ?? "");
  // Mensagem própria (já em português) passa direto; a genérica do zod, não.
  const emIngles = /^Invalid|^Expected|^Too |^Required/.test(issue.message);
  const nome = NOME_DO_CAMPO[campo];
  return {
    ok: false,
    error: emIngles
      ? nome
        ? `Confira ${nome}: o valor não foi entendido.`
        : "Confira os campos: algum valor não foi entendido."
      : issue.message,
    field: campo,
  };
}

/**
 * Erro de domínio vira mensagem; o resto vira log e uma frase honesta.
 *
 * `CatalogError` carrega a frase que a atendente precisa ler e o campo que
 * precisa piscar. Qualquer outra coisa é defeito nosso, e defeito nosso não se
 * explica para quem está tentando cadastrar um serviço.
 */
function falha(error: unknown, generica: string): CatalogResult {
  if (error instanceof CatalogError) return { ok: false, error: error.message, field: error.field };
  console.error(error);
  return { ok: false, error: generica };
}

const idSchema = z.number().int().positive();

const serviceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço."),
  categoryName: z.string().trim().max(80),
  description: z.string().trim().max(500).transform((v) => v || null),
  durationMin: z.number().int().min(5, "A duração mínima é 5 minutos.").max(720),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  commissionPct: z.number().min(0).max(100).nullable(),
  returnIntervalDays: z.number().int().min(1).max(365).nullable(),
  requiredResourceType: z.enum(["room", "cabin", "equipment"]).nullable(),
  onlineBooking: z.boolean(),
  professionalIds: z.array(idSchema),
});

const productSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do produto."),
  categoryName: z.string().trim().max(80),
  description: z.string().trim().max(500).transform((v) => v || null),
  sku: z.string().trim().max(80).transform((v) => v || null),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  stockQty: z.number().int().min(0),
});

/**
 * Uma ação para cadastrar e editar, como em `saveCustomerAction`.
 *
 * Duas ações separadas dobrariam as validações — e é justamente a validação
 * esquecida no ramo da edição que deixa um serviço sem profissional habilitado
 * sumir da agenda online sem ninguém perceber.
 */
export async function saveServiceAction(
  input: unknown,
  serviceId?: number,
): Promise<CatalogResult> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    if (serviceId === undefined) await createService(ctx, parsed.data);
    else await updateService(ctx, idSchema.parse(serviceId), parsed.data);
    revalidatePath("/catalogo");
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    return falha(
      error,
      serviceId === undefined
        ? "Não foi possível cadastrar o serviço."
        : "Não foi possível salvar o serviço.",
    );
  }
}

export async function saveProductAction(
  input: unknown,
  productId?: number,
): Promise<CatalogResult> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    if (productId === undefined) await createProduct(ctx, parsed.data);
    else await updateProduct(ctx, idSchema.parse(productId), parsed.data);
    revalidatePath("/catalogo");
    return { ok: true };
  } catch (error) {
    return falha(
      error,
      productId === undefined
        ? "Não foi possível cadastrar o produto."
        : "Não foi possível salvar o produto.",
    );
  }
}

export async function setServiceActiveAction(
  serviceId: unknown,
  active: unknown,
): Promise<CatalogResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await setServiceActive(ctx, idSchema.parse(serviceId), z.boolean().parse(active));
    revalidatePath("/catalogo");
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    return falha(error, "Não foi possível mudar a situação do serviço.");
  }
}

export async function setProductActiveAction(
  productId: unknown,
  active: unknown,
): Promise<CatalogResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await setProductActive(ctx, idSchema.parse(productId), z.boolean().parse(active));
    revalidatePath("/catalogo");
    return { ok: true };
  } catch (error) {
    return falha(error, "Não foi possível mudar a situação do produto.");
  }
}

/**
 * Quantos atendimentos futuros dependem deste serviço.
 *
 * A tela pergunta antes de oferecer o desligamento: desativar tira o serviço da
 * agenda e do agendamento online, mas quem já está marcado continua marcado, e
 * a dona precisa decidir sabendo o número.
 */
export async function contarFuturosAction(
  serviceId: unknown,
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    return { ok: true, total: await futurosDoServico(ctx, idSchema.parse(serviceId)) };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível consultar a agenda." };
  }
}
