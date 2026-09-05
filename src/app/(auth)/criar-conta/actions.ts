"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/server/auth";
import {
  type SignupField,
  BRAZIL_TIMEZONES,
  DEFAULT_TIMEZONE,
  clientIp,
  signUp,
} from "@/server/services/signup";

/**
 * Porta de entrada do autocadastro.
 *
 * Esta action é fina de propósito: valida forma, descobre o IP e delega. Toda
 * regra de segurança (limites, armadilha, plano, preço, `start`) vive em
 * `signup.ts`, que é onde ela pode ser testada sem simular uma requisição.
 *
 * O QUE NUNCA VEM DO FORMULÁRIO: preço, id de plano, status da assinatura e o
 * `start`. O formulário manda o slug do plano e o ciclo; o resto é decidido no
 * servidor a partir da linha de `plans`.
 */

export type SignupState = {
  error?: string;
  field?: SignupField;
};

const cycleFromForm = z.enum(["monthly", "quarterly", "yearly"]).catch("monthly");

const schema = z.object({
  clinicName: z.string().trim().min(2, "Escreva o nome da sua clínica.").max(120),
  ownerName: z.string().trim().min(2, "Escreva o seu nome.").max(120),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  phone: z.string().trim().min(8, "Informe um WhatsApp com DDD.").max(24),
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres.").max(200),
  planSlug: z.string().trim().min(1).max(64),
  cycle: cycleFromForm,
  // Sugestão do navegador. Fora da lista de fusos do Brasil vira Brasília —
  // recusar deixaria de fora quem acessa viajando, e a clínica é brasileira.
  timezone: z.enum(BRAZIL_TIMEZONES).catch(DEFAULT_TIMEZONE),
  honeypot: z.string().max(200).default(""),
  formIssuedAtMs: z.coerce.number().int().catch(0),
});

const CAMPOS: Record<string, SignupField> = {
  clinicName: "clinicName",
  ownerName: "ownerName",
  email: "email",
  phone: "phone",
  password: "password",
};

export async function signUpAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = schema.safeParse({
    clinicName: formData.get("clinicName") ?? "",
    ownerName: formData.get("ownerName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    password: formData.get("password") ?? "",
    planSlug: formData.get("planSlug") ?? "",
    cycle: formData.get("cycle") ?? "monthly",
    timezone: formData.get("timezone") ?? DEFAULT_TIMEZONE,
    honeypot: formData.get("site") ?? "",
    formIssuedAtMs: formData.get("formIssuedAtMs") ?? 0,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: CAMPOS[String(issue.path[0] ?? "")] };
  }

  const ip = clientIp(await headers());
  const resultado = await signUp({ ...parsed.data, ip });

  if (!resultado.ok) return { error: resultado.error, field: resultado.field };

  // A sessão só é aberta DEPOIS do commit. Criar o cookie dentro da transação
  // deixaria, num rollback, um cookie válido apontando para um usuário que não
  // existe — a pessoa entraria em um estado impossível de recuperar sozinha.
  await createSession(resultado.ownerUserId);

  // Fora de try/catch: `redirect` funciona lançando um erro de controle, e um
  // catch em volta o engoliria — o cadastro terminaria com a pessoa parada no
  // formulário, já logada e sem entender o que aconteceu.
  redirect("/hoje");
}
