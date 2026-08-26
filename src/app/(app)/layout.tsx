import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FusoProvider } from "@/lib/fuso";
import { getSession } from "@/server/auth";
import { isPlatformAdmin } from "@/server/platform-auth";
import { getAccountAccess } from "@/server/services/account-access";
import { getAttentionSignals } from "@/server/services/today-service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSession();
  if (!ctx) redirect("/entrar");

  // A checagem de plataforma é feita aqui, no servidor, contra `platform_admins`.
  // O papel na clínica (owner/admin) não conta: o acesso ao SaaS é concedido à parte.
  //
  // O portão de acesso entra no MESMO Promise.all: é uma ida ao banco em toda
  // navegação do painel, e em série ela apareceria no tempo de cada tela.
  const [signals, platformAdmin, access] = await Promise.all([
    getAttentionSignals(ctx),
    isPlatformAdmin(ctx.userId),
    getAccountAccess(ctx.organizationId),
  ]);

  // O destino está em src/app/(billing)/, fora deste grupo, justamente para não
  // passar por este layout — dentro de (app) o bloqueio redirecionaria a própria
  // tela de assinatura para si mesma, em laço.
  //
  // Este é o portão da LEITURA. O da ESCRITA está em `requireSession()`, porque
  // Server Action roda antes de qualquer layout — as duas checagens dividem a
  // mesma consulta na requisição (`cache` em account-access.ts).
  if (!access.allowed) redirect("/conta/assinatura");

  return (
    // O fuso do salão embrulha o painel inteiro: toda hora que aparece em tela
    // é hora do salão, e não a de quem renderizou. Em produção o servidor roda
    // em UTC.
    <FusoProvider fuso={ctx.timezone}>
      <AppShell
        user={{ name: ctx.userName, email: ctx.userEmail, role: ctx.role }}
        signals={signals}
        isPlatformAdmin={platformAdmin}
      >
        {children}
      </AppShell>
    </FusoProvider>
  );
}
