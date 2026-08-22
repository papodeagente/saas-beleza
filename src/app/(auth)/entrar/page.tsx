import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar — Lumina" };

export default async function LoginPage() {
  if (await getSession()) redirect("/hoje");

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-[360px]">
        <div className="mb-8">
          <span className="mb-6 flex size-8 items-center justify-center rounded-[9px] bg-accent text-[13px] font-semibold text-white">
            L
          </span>
          <h1 className="font-display text-[26px] leading-8 text-ink">Bom te ver de novo</h1>
          <p className="mt-1.5 text-[13px] text-ink-secondary">
            Entre para acompanhar a operação da sua clínica.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
