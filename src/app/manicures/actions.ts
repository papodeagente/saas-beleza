"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { permitirConsulta } from "@/app/agendar/[slug]/rate-limit";
import { clientIp } from "@/server/services/signup";
import {
  type Municipio,
  buscarMunicipios,
  municipiosProximos,
} from "@/server/services/location-service";

/**
 * As duas consultas que a tela de busca faz enquanto a pessoa digita ou pede o
 * GPS. Ambas são ANÔNIMAS — internet aberta — então passam pelo mesmo balde de
 * vazão das ações públicas do agendamento.
 *
 * A chave é `ip:marketplace` e não `ip:slug`: aqui não existe salão dono da
 * consulta, e usar o balde por slug deixaria estas chamadas sem teto nenhum.
 */
async function chave(): Promise<string> {
  return `${clientIp(await headers())}:marketplace`;
}

export async function buscarCidadesAction(termo: unknown): Promise<Municipio[]> {
  const parsed = z.string().max(120).safeParse(termo);
  if (!parsed.success) return [];
  if (!permitirConsulta(await chave())) return [];
  return buscarMunicipios(parsed.data);
}

const coordenadaSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Traduz a coordenada do GPS para municípios.
 *
 * O navegador dá lat/lng; o produto raciocina em cidade, porque a precisão do
 * cadastro é de cidade (o CEP normaliza endereço mas não devolve coordenada).
 * Devolver a cidade encontrada é o que permite a tela dizer "você está em
 * Natal" em vez de fingir uma distância de metros que o dado não sustenta.
 */
export async function cidadesPertoAction(input: unknown): Promise<Municipio[]> {
  const parsed = coordenadaSchema.safeParse(input);
  if (!parsed.success) return [];
  if (!permitirConsulta(await chave())) return [];
  return municipiosProximos(parsed.data.lat, parsed.data.lng, 80, 8);
}
