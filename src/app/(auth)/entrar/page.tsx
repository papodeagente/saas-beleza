import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

// Só o nome da tela: o layout raiz já aplica o template da marca. Repetir
// a marca aqui duplicaria o nome na aba — e a aba é a primeira
// coisa que a pessoa vê ao atravessar do site para o login.
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getSession()) redirect("/hoje");

  return (
    <AuthShell>
      <h1 className="text-display text-ink">Bom te ver de novo</h1>
      <p className="mt-1.5 text-body text-ink-secondary">
        Entre para acompanhar a operação da sua clínica.
      </p>

      <div className="mt-8">
        <LoginForm />
      </div>

      {/* Fora do <form>: quem chega do site sem conta não pode ser obrigado a
          descobrir isso errando a senha primeiro. */}
      <p className="mt-6 border-t border-line pt-5 text-center text-label text-ink-secondary">
        Ainda não tem conta?{" "}
        <Link
          href="/criar-conta"
          className="font-semibold text-accent underline underline-offset-4 transition-colors hover:text-accent-hover"
        >
          Criar conta
        </Link>
      </p>
    </AuthShell>
  );
}
