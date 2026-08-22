import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/server/auth";
import { getAttentionSignals } from "@/server/services/today-service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSession();
  if (!ctx) redirect("/entrar");

  const signals = await getAttentionSignals(ctx);

  return (
    <AppShell
      user={{ name: ctx.userName, email: ctx.userEmail, role: ctx.role }}
      organization={{ name: ctx.organizationName }}
      signals={signals}
    >
      {children}
    </AppShell>
  );
}
