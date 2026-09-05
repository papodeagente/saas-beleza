import { PageBody, PageHeader } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, DataRow } from "@/components/ui/card";
import { requireSession } from "@/server/auth";
import { AccountCode } from "./account-code";

export const metadata = { title: "Minha conta" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietária",
  admin: "Administração",
  staff: "Recepção",
  professional: "Profissional",
};

const ROLE_DESCRIPTION: Record<string, string> = {
  owner: "Acesso completo, incluindo financeiro, comissões e configurações da clínica.",
  admin: "Acesso à operação e ao financeiro da clínica.",
  staff: "Acesso à agenda, aos clientes e ao Inbox. O financeiro fica fora.",
  professional: "Acesso à própria agenda e aos atendimentos do dia.",
};

export default async function AccountPage() {
  const ctx = await requireSession();

  return (
    <div>
      <PageHeader title="Minha conta" description={ctx.organizationName} />

      <PageBody className="max-w-[640px]">
        <Card className="px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={ctx.userName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-card text-ink">{ctx.userName}</p>
              <p className="text-caption text-ink-secondary">{ROLE_LABEL[ctx.role] ?? ctx.role}</p>
            </div>
          </div>

          <dl className="mt-4 border-t border-line pt-2">
            <DataRow label="E-mail">{ctx.userEmail}</DataRow>
            <DataRow label="Clínica">{ctx.organizationName}</DataRow>
            {/* O código vem antes do fuso porque é o dado que alguém procura
                aqui com pressa, no meio de uma ligação com o suporte. */}
            <DataRow label="Código da conta">
              {/* A explicação fica colada no dado que ela explica. Solta ao pé
                  do cartão, virava a segunda frase cinza seguida e se
                  confundia com a descrição do papel logo abaixo. */}
              <span className="flex flex-col items-end gap-0.5">
                <AccountCode code={ctx.organizationCode} />
                <span className="text-meta text-ink-tertiary">
                  informe no suporte; não muda nunca
                </span>
              </span>
            </DataRow>
            <DataRow label="Fuso horário">{ctx.timezone}</DataRow>
          </dl>

          <p className="mt-3 text-caption text-ink-secondary">
            {ROLE_DESCRIPTION[ctx.role] ?? ""}
          </p>
        </Card>

        <Card className="mt-5 px-4 py-4">
          <h2 className="text-card text-ink">Senha</h2>
          <p className="mt-1 text-body text-ink-secondary">
            A troca de senha pela própria tela ainda não está disponível. Por enquanto, quem
            administra a clínica pode redefinir a sua senha.
          </p>
        </Card>

        <div className="mt-5">
          <form action="/api/sair" method="post">
            <Button type="submit" variant="secondary" size="md">
              Sair desta conta
            </Button>
          </form>
        </div>
      </PageBody>
    </div>
  );
}
