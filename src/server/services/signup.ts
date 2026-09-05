import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { plans, signupAttempts } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import {
  CreateAccountError,
  createAccount,
  slugFromClinicName,
} from "@/server/services/platform-account-create";
import { getPublicPlanBySlug } from "@/server/services/public-plans";

/**
 * Autocadastro público: a única porta pela qual um desconhecido escreve no
 * banco desta plataforma.
 *
 * ORDEM QUE MANDA AQUI: toda recusa acontece ANTES do bcrypt. Gerar o hash da
 * senha custa ~250ms de CPU (custo 12, deliberado), então recusar depois de
 * hashear transformaria a rota num amplificador: um roteirinho de vinte linhas
 * derrubaria o processo inteiro sem nunca criar uma conta. Por isso as
 * proteções ficam neste serviço, e não dentro de `createAccount`.
 *
 * A defesa é em camadas de custo crescente: interruptor (nada), limite por hora
 * (uma leitura indexada), armadilha e tempo de preenchimento (nada), slug e
 * plano (duas consultas), e só então a transação que hasheia e cria.
 *
 * O LIMITE VEM ANTES DAS ARMADILHAS, e não depois, porque toda recusa GRAVA uma
 * linha: deixar a armadilha na frente fazia o campo-isca ser um jeito de
 * escrever no banco sem nunca passar pelo portão. Ver `signUp`.
 */

/** Quantas tentativas o mesmo IP pode gastar por hora. */
export const SIGNUP_MAX_PER_IP_PER_HOUR = 5;
/**
 * Teto da plataforma inteira por hora. Existe porque limite por IP sozinho não
 * segura botnet: cem endereços com quatro tentativas cada passam ilesos pelo
 * limite individual.
 */
export const SIGNUP_MAX_PER_HOUR = 60;
/** Abaixo disto não foi gente digitando cinco campos. */
export const SIGNUP_MIN_FILL_MS = 3_000;

/**
 * Carimbo que a página entrega ao formulário e que volta no envio.
 *
 * Fica aqui, e não solto na página, porque forma par com `SIGNUP_MIN_FILL_MS`:
 * quem valida o tempo é este módulo, então quem emite o relógio também. Os dois
 * lados usam o relógio do SERVIDOR — comparar com o relógio do visitante
 * recusaria cadastro de quem está com a hora errada no computador.
 */
export function formStamp(): number {
  return Date.now();
}

/**
 * Endereços que não podem virar `/agendar/<slug>` de clínica nenhuma.
 *
 * O slug é o endereço público da agenda e nasce do nome digitado no cadastro.
 * Uma clínica chamada "Admin" ganharia um endereço que colide com as rotas do
 * produto — e, pior, um endereço que parece oficial para quem recebe o link.
 */
export const RESERVED_SLUGS = [
  "admin",
  "api",
  "app",
  "www",
  "entrar",
  "criar-conta",
  "assinatura",
  "agendar",
  "hoje",
  "agenda",
  "inbox",
  "conta",
  "suporte",
  "webhooks",
  "painel",
  // Rotas do marketplace. Precisam entrar aqui NO MESMO commit em que a rota
  // nasce: uma conta chamada "Buscar" sequestraria o endereço da busca, e o
  // slug de quem já se cadastrou não é reescrito depois.
  "manicures",
  "buscar",
  "cidade",
  "perto-de-mim",
  "marketplace",
  "salao",
  "saloes",
] as const;

/**
 * Fusos aceitos, lista fechada. O valor chega do navegador (a clínica não
 * escolhe fuso num cadastro de cinco campos) e vira o horário de TODA a agenda
 * e de todo relatório financeiro da conta — texto livre vindo do cliente aqui
 * seria uma agenda que nunca fecha.
 */
export const BRAZIL_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Maceio",
  "America/Bahia",
  "America/Araguaina",
  "America/Santarem",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Eirunepe",
  "America/Noronha",
] as const;

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Interruptor de emergência. Fica ligado por padrão de propósito: o cadastro é
 * o fim do funil, e um funil que só funciona depois de alguém lembrar de
 * configurar variável de ambiente é um funil quebrado em produção. Desliga com
 * `SIGNUP_ENABLED=off` (ou `false`/`0`) quando houver abuso em curso.
 */
export function signupEnabled(): boolean {
  const flag = process.env.SIGNUP_ENABLED?.trim().toLowerCase();
  return !(flag === "off" || flag === "false" || flag === "0");
}

/**
 * A aplicação roda atrás de proxy, então `x-forwarded-for` vem como cadeia, e
 * lemos o primeiro salto: ler o último limitaria o proxy, ou seja, todo mundo
 * de uma vez.
 *
 * LIMITAÇÃO CONHECIDA, escrita aqui para ninguém confiar demais: o primeiro
 * salto é o único que o VISITANTE pode escrever. O proxy da frente acrescenta o
 * endereço real ao fim da cadeia, não substitui o começo — então quem manda
 * `X-Forwarded-For: 1.2.3.4` na mão troca de "IP" a cada requisição e passa
 * pelo limite por endereço à vontade. Quem segura esse caso é o teto da
 * plataforma (`SIGNUP_MAX_PER_HOUR`), que não depende de identificar ninguém.
 * Fechar de verdade exige saber quantos proxies existem na frente da aplicação
 * e contar a partir do fim — chutar esse número derruba o cadastro inteiro,
 * então isso é decisão de quem conhece a topologia do deploy, não deste módulo.
 */
export function clientIp(requestHeaders: Headers): string {
  const encadeado = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encadeado) return encadeado;
  return requestHeaders.get("x-real-ip")?.trim() || "desconhecido";
}

export type SignupOutcome =
  | "created"
  | "disabled"
  | "honeypot"
  | "too_fast"
  | "rate_limited"
  | "reserved_slug"
  | "invalid_plan"
  | "email_taken"
  | "invalid"
  | "error";

/** Onde o formulário deve destacar o erro. */
export type SignupField = "clinicName" | "ownerName" | "email" | "phone" | "password";

export type SignupInput = {
  clinicName: string;
  ownerName: string;
  email: string;
  phone: string;
  password: string;
  planSlug: string;
  cycle: "monthly" | "quarterly" | "yearly";
  /** Fuso sugerido pelo navegador. Fora da lista, cai no de Brasília. */
  timezone: string;
  ip: string;
  /** Campo escondido do formulário: preenchido = robô. */
  honeypot: string;
  /** Instante (ms) em que o servidor entregou o formulário. */
  formIssuedAtMs: number;
};

export type SignupResult =
  | {
      ok: true;
      organizationId: number;
      ownerUserId: number;
      slug: string;
      trialEndsAt: Date | null;
    }
  | { ok: false; error: string; field?: SignupField; outcome: SignupOutcome };

/**
 * O registro da tentativa é o limitador: sem linha gravada não há contagem na
 * hora seguinte. Nunca guarda senha — só IP, e-mail tentado e desfecho.
 */
async function registrar(ip: string, email: string | null, outcome: SignupOutcome): Promise<void> {
  try {
    await db.insert(signupAttempts).values({ ip, email, outcome });
  } catch (error) {
    // Falha ao registrar não pode derrubar um cadastro legítimo em andamento.
    console.error("signup: falha ao registrar tentativa", error);
  }
}

async function recusar(
  ip: string,
  email: string | null,
  outcome: SignupOutcome,
  error: string,
  field?: SignupField,
): Promise<SignupResult> {
  await registrar(ip, email, outcome);
  return { ok: false, error, field, outcome };
}

function isReserved(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

function normalizeTimezone(value: string): string {
  return (BRAZIL_TIMEZONES as readonly string[]).includes(value) ? value : DEFAULT_TIMEZONE;
}

/**
 * Desfechos que denunciam robô. Contam para o IP que os produziu — é ele que
 * está se comportando mal — e NUNCA para o teto da plataforma.
 *
 * A distinção não é cosmética: o teto global é o orçamento que as clínicas de
 * verdade dividem entre si. Deixar um robô já identificado gastar esse
 * orçamento é entregar a chave do funil — sessenta requisições com o campo-isca
 * preenchido, que não custam um bcrypt sequer, fechavam o cadastro do país
 * inteiro por uma hora.
 */
const DESFECHOS_DE_ROBO = ["honeypot", "too_fast"] as const;

/**
 * Tentativas da última hora, deste IP e da plataforma toda, numa consulta só.
 *
 * Recusa por limite não entra na conta (hoje nem é gravada; o filtro fica para
 * linhas antigas). Se entrasse, cada tentativa bloqueada empurraria a janela
 * para frente e o bloqueio nunca terminaria — quem foi barrado por engano
 * ficaria de fora indefinidamente enquanto insistisse. O mesmo raciocínio é o
 * que tira robô identificado do teto global: ver `DESFECHOS_DE_ROBO`.
 */
async function tentativasNaUltimaHora(ip: string): Promise<{ doIp: number; total: number }> {
  const desde = new Date(Date.now() - 3_600_000);
  // Os desfechos entram no SQL como texto literal, e não como parâmetro de
  // array: são constantes deste módulo (nada vem do visitante) e o driver
  // reescreve array ligado de um jeito que já quebrou consulta em silêncio.
  const foraDoTeto = ["'rate_limited'", "'disabled'", ...DESFECHOS_DE_ROBO.map((o) => `'${o}'`)];
  const { rows } = await db.execute<{ do_ip: number; total: number }>(sql`
    select
      count(*) filter (where ip = ${ip} and outcome <> 'rate_limited')::int as do_ip,
      count(*) filter (where outcome not in (${sql.raw(foraDoTeto.join(", "))}))::int as total
    from signup_attempts
    where created_at >= ${desde}
  `);
  const linha = (rows as Array<{ do_ip: number; total: number }>)[0];
  return { doIp: linha?.do_ip ?? 0, total: linha?.total ?? 0 };
}

export async function signUp(input: SignupInput): Promise<SignupResult> {
  const ip = input.ip.slice(0, 64);
  const email = input.email.trim().toLowerCase();
  const clinicName = input.clinicName.trim();

  // Porta fechada por decisão nossa: não há tentativa a medir, então não há
  // linha a gravar. Registrar aqui daria a quem insiste uma escrita de graça no
  // banco enquanto o cadastro está justamente desligado.
  if (!signupEnabled()) {
    return {
      ok: false,
      outcome: "disabled",
      error: "O cadastro está temporariamente fechado. Fale com a gente que abrimos sua conta.",
    };
  }

  // O PORTÃO VEM ANTES DAS ARMADILHAS. Parece contra-intuitivo (é uma consulta
  // contra duas checagens de graça), mas as armadilhas não são de graça: elas
  // terminam em `recusar`, que GRAVA. Com elas na frente, um POST com o
  // campo-isca preenchido nunca chegava a consultar o portão — um único
  // endereço gravava sessenta linhas em segundos, estourava o teto da
  // plataforma e recusava o cadastro de todo mundo por uma hora, sem gastar um
  // bcrypt. Aqui a leitura é indexada por (ip, created_at) e sai mais barata
  // que a escrita que ela evita.
  const { doIp, total } = await tentativasNaUltimaHora(ip);
  if (doIp >= SIGNUP_MAX_PER_IP_PER_HOUR || total >= SIGNUP_MAX_PER_HOUR) {
    // Sem gravar: a recusa por limite é excluída de toda contagem, então a linha
    // não limitaria nada — só devolveria a quem já foi barrado uma escrita por
    // requisição, que é exatamente o abuso que acabamos de barrar.
    console.warn(`signup: limite atingido (ip=${ip}, ip/h=${doIp}, plataforma/h=${total})`);
    return {
      ok: false,
      outcome: "rate_limited",
      error: "Muitas tentativas de cadastro agora há pouco. Espere alguns minutos e tente de novo.",
    };
  }

  // Armadilha e relógio: custam zero e derrubam o robô que preenche tudo que
  // encontra em milissegundos. A mensagem é a mesma dos outros erros para não
  // ensinar o que denunciou o robô.
  if (input.honeypot.trim() !== "") {
    return recusar(ip, email, "honeypot", "Não foi possível criar a conta. Tente de novo.");
  }

  // Sem carimbo (campo omitido, que é o que um POST direto faz) também é robô:
  // zero seria lido como "preencheu desde 1970" e passaria batido. O carimbo é
  // do relógio do SERVIDOR, então relógio torto de visitante não recusa
  // cadastro legítimo. Isto é um quebra-molas, não uma tranca: o carimbo viaja
  // num campo escondido e não é assinado, então quem monta o POST na mão manda
  // o número que quiser. A tranca é o limite por hora, que já passou aqui em
  // cima.
  const preenchimentoMs = Date.now() - input.formIssuedAtMs;
  if (
    !Number.isFinite(input.formIssuedAtMs) ||
    input.formIssuedAtMs <= 0 ||
    preenchimentoMs < SIGNUP_MIN_FILL_MS
  ) {
    return recusar(ip, email, "too_fast", "Não foi possível criar a conta. Tente de novo.");
  }

  if (input.password.length < 8) {
    return recusar(
      ip,
      email,
      "invalid",
      "A senha precisa de pelo menos 8 caracteres.",
      "password",
    );
  }

  const phone = normalizePhone(input.phone);
  if (phone.length < 10 || phone.length > 13) {
    return recusar(ip, email, "invalid", "Informe um WhatsApp com DDD.", "phone");
  }

  const slugPretendido = slugFromClinicName(clinicName);
  if (isReserved(slugPretendido)) {
    return recusar(
      ip,
      email,
      "reserved_slug",
      "Esse nome não pode ser usado. Escreva o nome completo da clínica.",
      "clinicName",
    );
  }

  // O plano vem por SLUG e passa pelo filtro da vitrine (ativo + público). O
  // preço não é lido aqui de propósito: quem cobra é `createAccount`, relendo a
  // linha de `plans` pelo id — nenhum número do formulário chega ao banco.
  const plano = await getPublicPlanBySlug(input.planSlug);
  if (!plano) {
    return recusar(ip, email, "invalid_plan", "Este plano não está disponível para contratação.");
  }
  if (plano.trialDays <= 0) {
    return recusar(
      ip,
      email,
      "invalid_plan",
      "Este plano não tem teste grátis. Escolha a opção de assinatura no site.",
    );
  }

  // `PublicPlan` não expõe id (id numérico em página pública entrega contagem
  // de graça), então o id é resolvido aqui com os MESMOS filtros da vitrine.
  const [linhaPlano] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.slug, plano.slug), eq(plans.active, true), eq(plans.publicVisible, true)))
    .limit(1);
  if (!linhaPlano) {
    return recusar(ip, email, "invalid_plan", "Este plano não está disponível para contratação.");
  }

  try {
    const conta = await createAccount(
      { kind: "self_signup" },
      {
        clinicName,
        timezone: normalizeTimezone(input.timezone),
        ownerName: input.ownerName.trim(),
        ownerEmail: email,
        ownerPassword: input.password,
        ownerPhone: phone,
        planId: linhaPlano.id,
        cycle: input.cycle,
        // FORÇADO no servidor. Aceitar isto do formulário deixaria qualquer
        // visitante gravar um evento de receita e envenenar o MRR do painel —
        // cadastro público começa em teste, sempre.
        start: "trial",
      },
    );

    await registrar(ip, email, "created");
    return {
      ok: true,
      organizationId: conta.organizationId,
      ownerUserId: conta.ownerUserId,
      slug: conta.slug,
      trialEndsAt: conta.trialEndsAt,
    };
  } catch (error) {
    if (error instanceof CreateAccountError && error.code === "EMAIL_TAKEN") {
      return recusar(ip, email, "email_taken", error.message, "email");
    }
    console.error("signup: falha ao criar conta", error);
    return recusar(ip, email, "error", "Não foi possível criar a conta agora. Tente de novo.");
  }
}
