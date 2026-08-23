import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform-shell";
import { getPlatformSession } from "@/server/platform-auth";

export const metadata = { title: { default: "Plataforma", template: "%s · Plataforma Agenda de Unha" } };

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformSession();
  // Quem não é admin de plataforma vai para a clínica, não para uma tela de
  // erro: revelar que a rota existe já é informação demais.
  if (!ctx) redirect("/hoje");

  return (
    <PlatformShell user={{ name: ctx.userName, email: ctx.userEmail }}>{children}</PlatformShell>
  );
}
