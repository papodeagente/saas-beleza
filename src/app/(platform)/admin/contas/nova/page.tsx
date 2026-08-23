import Link from "next/link";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Card } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { listPlansForNewAccount } from "@/server/services/platform-account-create";
import { NewAccountForm } from "./new-account-form";

export const metadata = { title: "Nova conta" };
export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  await requirePlatformAdmin();
  const planos = await listPlansForNewAccount();

  return (
    <div>
      <PlatformHeader
        title="Nova conta"
        description="Cadastra a clínica, o acesso de quem responde por ela e a assinatura"
      />

      <PlatformBody className="max-w-[720px]">
        {planos.length === 0 ? (
          <Card className="px-5 py-6">
            <p className="text-card text-ink">Nenhum plano cadastrado</p>
            <p className="mt-1 text-body text-ink-secondary">
              Uma conta precisa de um plano para existir, mesmo que comece em teste.{" "}
              <Link href="/admin/planos" className="text-accent hover:text-accent-hover">
                Cadastre o primeiro plano
              </Link>{" "}
              e volte aqui.
            </p>
          </Card>
        ) : (
          <NewAccountForm planos={planos} />
        )}
      </PlatformBody>
    </div>
  );
}
