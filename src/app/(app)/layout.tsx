import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSession();
  if (!ctx) redirect("/entrar");

  return (
    <AppShell
      user={{ name: ctx.userName, email: ctx.userEmail }}
      organization={{ name: ctx.organizationName }}
    >
      {children}
    </AppShell>
  );
}
