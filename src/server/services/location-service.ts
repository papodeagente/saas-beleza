import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { municipios } from "@/db/schema";

/**
 * Lugar: CEP, municípios e distância.
 *
 * Este é o único arquivo que sabe transformar "onde fica" em coordenada. O
 * resto do produto só consome o resultado.
 *
 * O QUE O CEP RESOLVE E O QUE ELE NÃO RESOLVE
 *
 * O ViaCEP devolve logradouro, bairro, cidade, UF e o código do IBGE — mas NÃO
 * devolve latitude e longitude. Isso não é limitação da implementação, é o que
 * o serviço é: um normalizador de endereço, não um geocodificador.
 *
 * Então a coordenada de quem informou só o CEP é o CENTRO DO MUNICÍPIO, e ela
 * sai marcada como `geoPrecision: "cidade"`. Consequência que precisa estar
 * clara em quem for mexer aqui: dentro da mesma cidade todas as unidades
 * empatam no mesmo ponto, e ordenar por distância entre elas não significa
 * nada. Quem ordena resultado dentro de uma cidade tem de usar outro critério
 * — e nunca escrever "a 800m de você" com dado de precisão "cidade". Essa
 * mentira é o erro clássico de marketplace geolocalizado.
 *
 * O dia em que entrar um geocodificador de verdade ou o pino no mapa, a única
 * coisa que muda é `geoSource`/`geoPrecision` — o resto da busca continua igual.
 */

export type Municipio = {
  ibgeCode: number;
  name: string;
  uf: string;
  lat: number;
  lng: number;
  capital: boolean;
  ddd: number | null;
  timezone: string;
};

const COLUNAS = {
  ibgeCode: municipios.ibgeCode,
  name: municipios.name,
  uf: municipios.uf,
  lat: municipios.lat,
  lng: municipios.lng,
  capital: municipios.capital,
  ddd: municipios.ddd,
  timezone: municipios.timezone,
};

/**
 * Minúsculo e sem acento — a mesma regra que gerou `municipios.search_key` na
 * migration. Se as duas divergirem, a busca por cidade para de achar Brasília.
 */
export function dobrarParaBusca(texto: string): string {
  // O intervalo vai escrito como escape, e não como os caracteres literais: um
  // acento combinante colado dentro de uma expressão regular é invisível no
  // editor e some no primeiro copiar e colar.
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function apenasDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// CEP
// ---------------------------------------------------------------------------

export type EnderecoDoCep = {
  postalCode: string;
  street: string | null;
  district: string | null;
  city: string;
  uf: string;
  ibgeCode: number | null;
};

export class CepError extends Error {
  constructor(
    message: string,
    readonly code: "INVALIDO" | "NAO_ENCONTRADO" | "INDISPONIVEL",
  ) {
    super(message);
  }
}

/**
 * Consulta o ViaCEP.
 *
 * Chamada de fora do processo dentro de uma Server Action, então tem prazo: sem
 * o `AbortSignal` um ViaCEP lento seguraria a conexão do pool e a tela ficaria
 * girando. Oito segundos é generoso para um serviço que responde em menos de
 * um, e curto o bastante para a clínica preferir digitar o endereço à mão.
 *
 * O ViaCEP não publica SLA nem limite de vazão e bloqueia por abuso. Aqui a
 * chamada é UMA por cadastro de unidade, feita por quem está autenticado — uso
 * legítimo. Varrer a base inteira num laço não seria, e é por isso que não
 * existe backfill automático em cima disto.
 */
export async function buscarCep(cepBruto: string): Promise<EnderecoDoCep> {
  const cep = apenasDigitos(cepBruto);
  if (cep.length !== 8) throw new CepError("CEP precisa ter 8 dígitos.", "INVALIDO");

  let resposta: Response;
  try {
    resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
  } catch {
    throw new CepError("Não conseguimos consultar o CEP agora.", "INDISPONIVEL");
  }
  if (!resposta.ok) throw new CepError("Não conseguimos consultar o CEP agora.", "INDISPONIVEL");

  const dados = (await resposta.json()) as {
    erro?: boolean | string;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
    ibge?: string;
  };

  // O ViaCEP responde 200 com `{"erro": true}` para CEP inexistente — e em
  // algumas respostas o valor vem como a STRING "true". Comparar com `===
  // true` deixava passar.
  if (dados.erro || !dados.localidade || !dados.uf) {
    throw new CepError("CEP não encontrado.", "NAO_ENCONTRADO");
  }

  const ibge = Number(dados.ibge);
  return {
    postalCode: cep,
    street: dados.logradouro?.trim() || null,
    district: dados.bairro?.trim() || null,
    city: dados.localidade.trim(),
    uf: dados.uf.trim().toUpperCase(),
    ibgeCode: Number.isFinite(ibge) && ibge > 0 ? ibge : null,
  };
}

// ---------------------------------------------------------------------------
// Municípios
// ---------------------------------------------------------------------------

export async function municipioPorCodigo(ibgeCode: number): Promise<Municipio | null> {
  const [linha] = await db
    .select(COLUNAS)
    .from(municipios)
    .where(eq(municipios.ibgeCode, ibgeCode))
    .limit(1);
  return linha ?? null;
}

/** Casa cidade + UF quando o código do IBGE não veio. */
export async function municipioPorNome(cidade: string, uf: string): Promise<Municipio | null> {
  const [linha] = await db
    .select(COLUNAS)
    .from(municipios)
    .where(
      and(
        eq(municipios.searchKey, dobrarParaBusca(cidade)),
        eq(municipios.uf, uf.toUpperCase()),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/**
 * Busca por prefixo, para o campo "sua cidade".
 *
 * `like 'termo%'` e não `%termo%`: o índice btree de `search_key` só serve ao
 * prefixo, e é o que a pessoa digita — ninguém procura cidade pelo meio do
 * nome. Capitais primeiro porque é o que a maioria quer.
 */
export async function buscarMunicipios(termo: string, limite = 8): Promise<Municipio[]> {
  const chave = dobrarParaBusca(termo);
  if (chave.length < 2) return [];
  return db
    .select(COLUNAS)
    .from(municipios)
    .where(sql`${municipios.searchKey} like ${`${chave}%`}`)
    .orderBy(sql`${municipios.capital} desc`, asc(municipios.name))
    .limit(limite);
}

export type MunicipioProximo = Municipio & { km: number };

/**
 * Municípios mais próximos de uma coordenada — o "perto de mim" do GPS.
 *
 * CAIXA DELIMITADORA + HAVERSINE, SEM POSTGIS.
 *
 * A caixa corta em btree usando `municipios_geo_idx` e o Haversine só roda
 * sobre o punhado que sobrou. Instalar PostGIS por reflexo seria arriscar o
 * deploy inteiro: a migration roda no start do contêiner e um `CREATE
 * EXTENSION` que falhe impede o servidor de subir.
 *
 * O delta de longitude é dividido por `cos(lat)` porque um grau de longitude
 * encolhe conforme se afasta do equador — sem isso a caixa fica estreita
 * demais no Sul e larga demais no Norte, e cidades vizinhas somem do resultado.
 */
export async function municipiosProximos(
  lat: number,
  lng: number,
  raioKm = 60,
  limite = 12,
): Promise<MunicipioProximo[]> {
  const grausLat = raioKm / 111;
  const cos = Math.cos((lat * Math.PI) / 180);
  // Perto dos polos o cosseno tende a zero e a caixa explodiria para o globo
  // inteiro. O Brasil não chega lá, mas o piso é barato.
  const grausLng = raioKm / (111 * Math.max(0.15, Math.abs(cos)));

  const distancia = sql<number>`
    6371 * acos(least(1, greatest(-1,
      cos(radians(${lat})) * cos(radians(${municipios.lat})) *
      cos(radians(${municipios.lng}) - radians(${lng})) +
      sin(radians(${lat})) * sin(radians(${municipios.lat}))
    )))`;

  return db
    .select({ ...COLUNAS, km: distancia })
    .from(municipios)
    .where(
      and(
        gte(municipios.lat, lat - grausLat),
        lte(municipios.lat, lat + grausLat),
        gte(municipios.lng, lng - grausLng),
        lte(municipios.lng, lng + grausLng),
      ),
    )
    .orderBy(distancia)
    .limit(limite);
}

/** Distância em km entre dois pontos. Espelha o Haversine do SQL. */
export function distanciaKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const seno =
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng) - rad(aLng)) +
    Math.sin(rad(aLat)) * Math.sin(rad(bLat));
  return 6371 * Math.acos(Math.min(1, Math.max(-1, seno)));
}
