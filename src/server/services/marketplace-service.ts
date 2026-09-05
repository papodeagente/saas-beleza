import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { distanciaKm } from "./location-service";

/**
 * O diretório público de manicures.
 *
 * É a única leitura do produto que atravessa TODAS as contas. Todo o resto
 * parte de um `organizationId` vindo da sessão ou de um slug; aqui a consulta é
 * o oposto — varre a base filtrando por lugar. Por isso os índices que ela usa
 * (`branches_cidade_idx`, `branches_geo_idx`) foram criados junto: nenhum
 * índice pré-existente serve, todos começam por `organization_id`.
 *
 * O QUE APARECE, E POR QUÊ CADA TRAVA EXISTE
 *
 *  1. `marketplace_listed` — opt-in explícito da conta. Nasce falso.
 *  2. `branches.active` — a unidade fechada some do diretório sem apagar
 *     histórico.
 *  3. `lat is not null` — sem coordenada não há como ordenar nem situar; a
 *     unidade sem endereço fica de fora até a clínica preencher.
 *  4. O PORTÃO COMERCIAL, abaixo. Sem ele o diretório venderia publicamente a
 *     agenda de quem não paga — exatamente o furo que `getPublicOrganization`
 *     fechou no link individual.
 *  5. Pelo menos um serviço publicado. Cartão sem preço não é oferta.
 */

/**
 * O portão comercial em SQL.
 *
 * É a MESMA regra de `getAccountAccess` (src/server/services/account-access.ts),
 * escrita uma segunda vez porque a original é por conta e faria uma consulta
 * por cartão da lista — vinte salões na tela, vinte idas ao banco.
 *
 * Duas verdades sobre a mesma regra é exatamente o tipo de coisa que sai de
 * sincronia, então existe um teste (`marketplace.integration.test.ts`) que
 * confronta este predicado com `getAccountAccess` numa matriz de estados. Se
 * alguém mudar uma das duas sem a outra, o teste cai.
 *
 * Cuidado de NULL que motivou a forma positiva: escrever
 * `NOT (status = 'trialing' AND ...)` devolve NULL quando não há assinatura, e
 * NULL no WHERE descarta a linha — a conta gerida na mão (fundador, parceiro,
 * demonstração) sumiria do diretório sem ninguém entender por quê.
 */
const PORTAO_COMERCIAL = sql`
  o.suspended_at is null
  and (
    s.status is null
    or (
      (s.status <> 'trialing' or s.trial_ends_at is null or s.trial_ends_at > now())
      and
      (s.status <> 'canceled' or coalesce(s.current_period_end, s.canceled_at) > now())
    )
  )`;

export type CartaoDoSalao = {
  organizationId: number;
  slug: string;
  nome: string;
  bio: string | null;
  whatsapp: string | null;
  instagram: string | null;
  branchId: number;
  unidade: string;
  endereco: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  lat: number;
  lng: number;
  /** "cidade" significa centro do município — a tela NÃO pode dizer "a 800m". */
  precisao: "exata" | "rua" | "bairro" | "cidade" | "nenhuma";
  km: number | null;
  servicos: number;
  precoMinCents: number | null;
  categorias: string[];
};

export type FiltroBusca = {
  /** Código do IBGE. Quando vem, manda em tudo: é busca por cidade. */
  ibgeCode?: number;
  /** Coordenada de quem busca — do GPS ou do centro da cidade escolhida. */
  lat?: number;
  lng?: number;
  raioKm?: number;
  /** Texto livre: nome do salão ou nome de serviço. */
  termo?: string;
  pagina?: number;
  porPagina?: number;
};

const POR_PAGINA_PADRAO = 12;
const POR_PAGINA_MAX = 48;

/**
 * Busca salões.
 *
 * DUAS consultas, não N+1: uma traz a página de unidades, outra os agregados
 * (quantos serviços, a partir de quanto, quais categorias) só das contas que
 * ficaram na página. Fazer o agregado por linha custaria uma ida ao banco por
 * cartão contra um pool de dez conexões.
 */
export async function buscarSaloes(
  filtro: FiltroBusca,
): Promise<{ itens: CartaoDoSalao[]; total: number }> {
  const porPagina = Math.min(POR_PAGINA_MAX, Math.max(1, filtro.porPagina ?? POR_PAGINA_PADRAO));
  const pagina = Math.max(1, filtro.pagina ?? 1);
  const deslocamento = (pagina - 1) * porPagina;

  const condicoes = [
    sql`o.marketplace_listed = true`,
    sql`b.active = true`,
    sql`b.lat is not null`,
    PORTAO_COMERCIAL,
    // Conta sem nenhum serviço publicado não vira cartão: seria uma vitrine
    // com a porta aberta e a prateleira vazia.
    sql`exists (
      select 1 from services sv
      where sv.organization_id = o.id and sv.active = true and sv.online_booking = true
    )`,
  ];

  if (filtro.ibgeCode) condicoes.push(sql`b.ibge_code = ${filtro.ibgeCode}`);

  // Caixa delimitadora ANTES do Haversine: corta em índice e deixa o cálculo
  // caro só para o que sobrou.
  const temGeo = filtro.lat != null && filtro.lng != null;
  if (temGeo && !filtro.ibgeCode) {
    const raio = filtro.raioKm ?? 60;
    const grausLat = raio / 111;
    const cos = Math.cos((filtro.lat! * Math.PI) / 180);
    const grausLng = raio / (111 * Math.max(0.15, Math.abs(cos)));
    condicoes.push(sql`b.lat between ${filtro.lat! - grausLat} and ${filtro.lat! + grausLat}`);
    condicoes.push(sql`b.lng between ${filtro.lng! - grausLng} and ${filtro.lng! + grausLng}`);
  }

  if (filtro.termo && filtro.termo.trim().length >= 2) {
    const alvo = `%${filtro.termo.trim().toLowerCase()}%`;
    condicoes.push(sql`(
      lower(o.name) like ${alvo}
      or exists (
        select 1 from services sv
        where sv.organization_id = o.id and sv.active = true and sv.online_booking = true
          and lower(sv.name) like ${alvo}
      )
    )`);
  }

  const onde = sql.join(condicoes, sql` and `);

  const distancia = temGeo
    ? sql`6371 * acos(least(1, greatest(-1,
        cos(radians(${filtro.lat})) * cos(radians(b.lat)) *
        cos(radians(b.lng) - radians(${filtro.lng})) +
        sin(radians(${filtro.lat})) * sin(radians(b.lat))
      )))`
    : sql`null::double precision`;

  /**
   * A ordenação tem um degrau que precisa estar escrito.
   *
   * Quando a precisão é "cidade" — que é o caso de TODA unidade cadastrada por
   * CEP, porque o ViaCEP não devolve coordenada — todas as unidades da mesma
   * cidade dividem o mesmo ponto. Ordenar por distância entre elas não decide
   * nada: é empate técnico disfarçado de ranking.
   *
   * Então a distância ordena CIDADES, e dentro da cidade o desempate é o nome,
   * que é estável e honesto. Não há critério de qualidade ainda; inventar um
   * (mais serviços à frente, mais barato à frente) seria escolher vencedor sem
   * o dono ter decidido a regra.
   */
  const ordem = temGeo ? sql`km asc nulls last, o.name asc` : sql`o.name asc`;

  const linhas = await db.execute<{
    organization_id: number;
    slug: string;
    nome: string;
    bio: string | null;
    whatsapp: string | null;
    instagram: string | null;
    branch_id: number;
    unidade: string;
    endereco: string | null;
    bairro: string | null;
    cidade: string;
    uf: string;
    lat: number;
    lng: number;
    precisao: CartaoDoSalao["precisao"] | null;
    km: number | null;
    total: string;
  }>(sql`
    select
      o.id as organization_id, o.slug, o.name as nome,
      o.marketplace_bio as bio, o.marketplace_whatsapp as whatsapp,
      o.marketplace_instagram as instagram,
      b.id as branch_id, b.name as unidade, b.address as endereco,
      b.district as bairro, b.city as cidade, b.uf, b.lat, b.lng,
      b.geo_precision as precisao,
      ${distancia} as km,
      count(*) over () as total
    from organizations o
    join branches b on b.organization_id = o.id
    left join subscriptions s on s.organization_id = o.id
    where ${onde}
    order by ${ordem}
    limit ${porPagina} offset ${deslocamento}
  `);

  if (linhas.rows.length === 0) return { itens: [], total: 0 };

  const orgIds = [...new Set(linhas.rows.map((l) => l.organization_id))];
  const agregados = await agregadosDeServico(orgIds);

  return {
    total: Number(linhas.rows[0].total),
    itens: linhas.rows.map((l) => {
      const agg = agregados.get(l.organization_id);
      return {
        organizationId: l.organization_id,
        slug: l.slug,
        nome: l.nome,
        bio: l.bio,
        whatsapp: l.whatsapp,
        instagram: l.instagram,
        branchId: l.branch_id,
        unidade: l.unidade,
        endereco: l.endereco,
        bairro: l.bairro,
        cidade: l.cidade,
        uf: l.uf,
        lat: Number(l.lat),
        lng: Number(l.lng),
        precisao: l.precisao ?? "nenhuma",
        km: l.km == null ? null : Number(l.km),
        servicos: agg?.servicos ?? 0,
        precoMinCents: agg?.precoMinCents ?? null,
        categorias: agg?.categorias ?? [],
      };
    }),
  };
}

async function agregadosDeServico(orgIds: number[]) {
  const lista = sql.join(
    orgIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const linhas = await db.execute<{
    organization_id: number;
    servicos: string;
    preco_min: number | null;
    categorias: string[] | null;
  }>(sql`
    select
      sv.organization_id,
      count(*) as servicos,
      min(sv.price_cents) as preco_min,
      array_remove(array_agg(distinct sc.name), null) as categorias
    from services sv
    left join service_categories sc on sc.id = sv.category_id
    where sv.organization_id in (${lista})
      and sv.active = true and sv.online_booking = true
    group by sv.organization_id
  `);
  return new Map(
    linhas.rows.map((l) => [
      l.organization_id,
      {
        servicos: Number(l.servicos),
        precoMinCents: l.preco_min == null ? null : Number(l.preco_min),
        categorias: (l.categorias ?? []).slice(0, 4),
      },
    ]),
  );
}

/** Cidades que têm pelo menos um salão listado. É o que alimenta a home. */
export async function cidadesComSalao(
  limite = 24,
): Promise<Array<{ ibgeCode: number; cidade: string; uf: string; lat: number; lng: number; saloes: number }>> {
  const linhas = await db.execute<{
    ibge_code: number;
    cidade: string;
    uf: string;
    lat: number;
    lng: number;
    saloes: string;
  }>(sql`
    select m.ibge_code, m.name as cidade, m.uf, m.lat, m.lng,
           count(distinct o.id) as saloes
    from organizations o
    join branches b on b.organization_id = o.id
    join municipios m on m.ibge_code = b.ibge_code
    left join subscriptions s on s.organization_id = o.id
    where o.marketplace_listed = true and b.active = true and b.ibge_code is not null
      and ${PORTAO_COMERCIAL}
    group by m.ibge_code, m.name, m.uf, m.lat, m.lng
    order by saloes desc, m.name asc
    limit ${limite}
  `);
  return linhas.rows.map((l) => ({
    ibgeCode: l.ibge_code,
    cidade: l.cidade,
    uf: l.uf,
    lat: Number(l.lat),
    lng: Number(l.lng),
    saloes: Number(l.saloes),
  }));
}

/**
 * Diz se uma conta está de fato visível no diretório.
 *
 * O perfil público e a busca precisam concordar: um salão que aparece na lista
 * e dá 404 ao ser aberto é pior que não aparecer.
 */
export async function estaListado(slug: string): Promise<boolean> {
  const linhas = await db.execute<{ existe: number }>(sql`
    select 1 as existe
    from organizations o
    left join subscriptions s on s.organization_id = o.id
    where o.slug = ${slug} and o.marketplace_listed = true and ${PORTAO_COMERCIAL}
    limit 1
  `);
  return linhas.rows.length > 0;
}

/** Reexporta para a camada de tela não precisar conhecer o location-service. */
export { distanciaKm };

export type PerfilPublico = {
  organizationId: number;
  slug: string;
  nome: string;
  bio: string | null;
  whatsapp: string | null;
  instagram: string | null;
  unidades: Array<{
    id: number;
    nome: string;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    telefone: string | null;
    lat: number | null;
    lng: number | null;
    precisao: CartaoDoSalao["precisao"];
  }>;
};

/**
 * O perfil de um salão no diretório.
 *
 * Não repete o catálogo de serviços: quem quer o preço e a agenda vai para
 * `/agendar/<slug>`, que já é a página de marcação e já resolve disponibilidade,
 * fuso e revalidação. Duplicar aquela tela aqui criaria duas verdades sobre o
 * mesmo horário.
 *
 * Devolve null quando a conta não está listada — a busca e o perfil precisam
 * concordar. Salão que aparece na lista e dá 404 ao abrir é pior que ausente.
 */
export async function perfilPublico(slug: string): Promise<PerfilPublico | null> {
  const linhas = await db.execute<{
    organization_id: number;
    slug: string;
    nome: string;
    bio: string | null;
    whatsapp: string | null;
    instagram: string | null;
    branch_id: number | null;
    unidade: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    telefone: string | null;
    lat: number | null;
    lng: number | null;
    precisao: CartaoDoSalao["precisao"] | null;
  }>(sql`
    select
      o.id as organization_id, o.slug, o.name as nome,
      o.marketplace_bio as bio, o.marketplace_whatsapp as whatsapp,
      o.marketplace_instagram as instagram,
      b.id as branch_id, b.name as unidade, b.address as endereco,
      b.district as bairro, b.city as cidade, b.uf, b.phone as telefone,
      b.lat, b.lng, b.geo_precision as precisao
    from organizations o
    left join branches b on b.organization_id = o.id and b.active = true
    left join subscriptions s on s.organization_id = o.id
    where o.slug = ${slug} and o.marketplace_listed = true and ${PORTAO_COMERCIAL}
    order by b.name asc
  `);

  const primeira = linhas.rows[0];
  if (!primeira) return null;

  return {
    organizationId: primeira.organization_id,
    slug: primeira.slug,
    nome: primeira.nome,
    bio: primeira.bio,
    whatsapp: primeira.whatsapp,
    instagram: primeira.instagram,
    unidades: linhas.rows
      .filter((l) => l.branch_id != null)
      .map((l) => ({
        id: l.branch_id!,
        nome: l.unidade!,
        endereco: l.endereco,
        bairro: l.bairro,
        cidade: l.cidade,
        uf: l.uf,
        telefone: l.telefone,
        lat: l.lat == null ? null : Number(l.lat),
        lng: l.lng == null ? null : Number(l.lng),
        precisao: l.precisao ?? "nenhuma",
      })),
  };
}
