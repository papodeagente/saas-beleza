"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { type LoginState, login } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
      Entrar
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});
  // O erro é único para os dois campos (não revela se o e-mail existe), então
  // os dois inputs apontam para a mesma mensagem via aria-describedby.
  const errorId = state.error ? "email-desc" : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <Field label="E-mail" htmlFor="email" error={state.error}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="voce@clinica.com.br"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={errorId}
        />
      </Field>

      <Field label="Senha" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={errorId}
        />
      </Field>

      <SubmitButton />

      <p className="text-center">
        <Link
          href="/entrar/recuperar"
          className="inline-flex min-h-11 items-center px-2 text-label text-ink-secondary underline underline-offset-4 transition-colors hover:text-ink"
        >
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}
