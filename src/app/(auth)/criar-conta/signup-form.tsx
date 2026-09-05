"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { type SignupState, signUpAction } from "./actions";

/**
 * (11) 98888-7777 enquanto a pessoa digita.
 *
 * A máscara existe para o DDD: sem separação visual, número colado passa com
 * dígito a mais ou a menos e o WhatsApp da conta nasce errado — e é o único
 * canal pelo qual alcançamos a clínica durante o teste.
 */
function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
      {label}
    </Button>
  );
}

export function SignupForm({
  planSlug,
  cycle,
  formIssuedAtMs,
  submitLabel,
}: {
  planSlug: string;
  /** Como veio na URL: é o que o formulário devolve para a action. */
  cycle: "monthly" | "quarterly" | "yearly";
  formIssuedAtMs: number;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<SignupState, FormData>(signUpAction, {});

  // Os cinco campos são controlados porque o React limpa formulário não
  // controlado depois da action: recusar por e-mail repetido e ainda apagar o
  // que a pessoa digitou faria ela desistir no lugar de corrigir.
  const [clinicName, setClinicName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // O fuso vem do navegador porque um cadastro de cinco campos não pergunta
  // isso — e o servidor só aceita fusos do Brasil, então o pior caso é cair em
  // Brasília. Sem JS o campo vai vazio e o servidor decide sozinho.
  const timezoneRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zona && timezoneRef.current) timezoneRef.current.value = zona;
  }, []);

  const erroGeral = state.error && !state.field ? state.error : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="planSlug" value={planSlug} />
      <input type="hidden" name="cycle" value={cycle} />
      <input type="hidden" name="formIssuedAtMs" value={formIssuedAtMs} />
      <input ref={timezoneRef} type="hidden" name="timezone" defaultValue="" />

      {/* Armadilha: invisível e fora da ordem de tabulação, então só um robô
          que preenche tudo que encontra escreve aqui. `aria-hidden` mantém o
          leitor de tela longe de um campo que não é para ninguém. */}
      <div aria-hidden className="hidden">
        <label htmlFor="site">Não preencha este campo</label>
        <input id="site" name="site" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {erroGeral ? (
        <p
          role="alert"
          className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-caption text-danger"
        >
          {erroGeral}
        </p>
      ) : null}

      <Field
        label="Nome da clínica"
        htmlFor="clinicName"
        error={state.field === "clinicName" ? state.error : undefined}
      >
        <Input
          id="clinicName"
          name="clinicName"
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          placeholder="Clínica Bela Face"
          autoComplete="organization"
          required
          autoFocus
          aria-invalid={state.field === "clinicName" ? true : undefined}
        />
      </Field>

      <Field
        label="Seu nome"
        htmlFor="ownerName"
        error={state.field === "ownerName" ? state.error : undefined}
      >
        <Input
          id="ownerName"
          name="ownerName"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder="Maria Fernandes"
          autoComplete="name"
          required
          aria-invalid={state.field === "ownerName" ? true : undefined}
        />
      </Field>

      <Field
        label="E-mail"
        htmlFor="email"
        error={state.field === "email" ? state.error : undefined}
        hint={state.field === "email" ? undefined : "É com ele que você entra no sistema."}
      >
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@clinica.com.br"
          autoComplete="email"
          required
          aria-invalid={state.field === "email" ? true : undefined}
        />
      </Field>

      <Field
        label="WhatsApp"
        htmlFor="phone"
        error={state.field === "phone" ? state.error : undefined}
        hint={state.field === "phone" ? undefined : "Com DDD. É por aqui que a gente te ajuda."}
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(mascararTelefone(e.target.value))}
          placeholder="(11) 98888-7777"
          autoComplete="tel"
          required
          aria-invalid={state.field === "phone" ? true : undefined}
        />
      </Field>

      <Field
        label="Senha"
        htmlFor="password"
        error={state.field === "password" ? state.error : undefined}
        hint={state.field === "password" ? undefined : "Pelo menos 8 caracteres."}
      >
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={state.field === "password" ? true : undefined}
        />
      </Field>

      <SubmitButton label={submitLabel} />

      <p className="text-center text-caption text-ink-tertiary">
        Ao criar a conta você concorda em receber nosso contato pelo WhatsApp.
      </p>
    </form>
  );
}
