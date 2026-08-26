"use client";

import { createContext, useContext } from "react";

/**
 * O fuso do salão, disponível a toda tela do painel.
 *
 * Existe porque a hora que a atendente lê é a hora do SALÃO, não a de quem
 * renderizou a página. O servidor de produção roda em UTC: sem isto, a primeira
 * pintura saía três horas adiantada e o React trocava o texto na reidratação —
 * a mensagem das 16:09 aparecia como 19:09, e depois voltava.
 *
 * É contexto e não propriedade porque a hora aparece em bolha de mensagem,
 * linha de lista, cartão de agendamento e aviso de conexão, todos a três ou
 * quatro níveis de distância da página. Propagar por propriedade seria o mesmo
 * fuso escrito quinze vezes, e o defeito volta na décima sexta.
 */
const FusoContext = createContext<string | null>(null);

export function FusoProvider({ fuso, children }: { fuso: string; children: React.ReactNode }) {
  return <FusoContext.Provider value={fuso}>{children}</FusoContext.Provider>;
}

/**
 * Falha alto quando falta o provedor.
 *
 * A alternativa seria cair em "America/Sao_Paulo" por padrão — e aí um salão em
 * Manaus veria toda a agenda uma hora adiantada sem nada na tela denunciando.
 * Erro que se esconde num fuso plausível é o erro que ninguém acha.
 */
export function useFuso(): string {
  const fuso = useContext(FusoContext);
  if (!fuso) throw new Error("useFuso() fora do FusoProvider: o fuso do salão não chegou à tela.");
  return fuso;
}
