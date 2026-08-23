import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/server/auth";
import { isPlatformAdmin } from "@/server/platform-auth";
import { getAttentionSignals } from "@/server/services/today-service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSession();
  if (!ctx) redirect("/entrar");

  // A checagem é feita aqui, no servidor, contra `platform_admins`. O papel na
  // clínica (owner/admin) não conta: o acesso ao SaaS é concedido à parte.
  const [signals, platformAdmin] = await Promise.all([
    getAttentionSignals(ctx),
    isPlatformAdmin(ctx.userId),
  ]);

  return (
    <AppShell
      user={{ name: ctx.userName, email: ctx.userEmail, role: ctx.role }}
      organization={{ name: ctx.organizationName }}
      signals={signals}
      isPlatformAdmin={platformAdmin}
    >
      {children}
    </AppShell>
  );
}
