import { ShieldCheck } from "lucide-react";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Card } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { listPlatformAdmins } from "@/server/services/platform-admins";
import { AdminList } from "./admin-list";

export const metadata = { title: "Administradores" };
export const dynamic = "force-dynamic";

export default async function PlatformAdminsPage() {
  const ctx = await requirePlatformAdmin();
  const admins = await listPlatformAdmins(ctx);

  return (
    <div>
      <PlatformHeader
        title="Administradores da plataforma"
        description={`${admins.length} ${admins.length === 1 ? "pessoa tem" : "pessoas têm"} acesso ao SaaS inteiro`}
      />

      <PlatformBody className="max-w-[860px] space-y-6">
        <Card className="flex gap-3 px-5 py-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <div>
            <p className="text-card text-ink">O que este acesso permite</p>
            <p className="mt-1 text-body text-ink-secondary">
              Quem administra a plataforma enxerga os dados de <strong>todas as clínicas</strong>, o
              faturamento do SaaS por inteiro, e pode trocar planos, cancelar assinaturas e suspender
              qualquer conta. É um acesso separado do papel dentro da clínica: ser proprietária de uma
              clínica não dá nenhum poder aqui, e o contrário também vale.
            </p>
          </div>
        </Card>

        <AdminList
          admins={admins.map((a) => ({
            ...a,
            grantedAtISO: a.grantedAt.toISOString(),
          }))}
          currentUserId={ctx.userId}
        />
      </PlatformBody>
    </div>
  );
}
