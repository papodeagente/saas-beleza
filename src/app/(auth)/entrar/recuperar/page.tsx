import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AuthShell } from "../../auth-shell";

// O template "%s · Lumina" do layout raiz já põe a marca; ver /entrar.
export const metadata = { title: "Recuperar senha" };

/**
 * Tela honesta: a Lumina ainda não tem redefinição por e-mail. Em vez de
 * simular um fluxo de token que não existe, explica o caminho real — pedir
 * uma nova senha a quem administra a conta da clínica.
 */
export default function RecoverPasswordPage() {
  return (
    <AuthShell>
      <h1 className="text-display text-ink">Recuperar senha</h1>
      <p className="mt-1.5 text-body text-ink-secondary">
        A redefinição de senha por e-mail ainda não existe na Lumina. Não há nada para esperar na
        sua caixa de entrada.
      </p>

      <Card className="mt-6 px-4 py-4">
        <h2 className="text-card text-ink">Como voltar a entrar</h2>
        <p className="mt-1.5 text-body text-ink-secondary">
          Peça ao administrador da sua clínica — a pessoa que criou o seu acesso — para cadastrar
          uma nova senha para o seu e-mail. Depois disso, entre normalmente com ela.
        </p>
      </Card>

      <Button asChild variant="secondary" size="lg" className="mt-6 w-full">
        <Link href="/entrar">Voltar para o login</Link>
      </Button>
    </AuthShell>
  );
}
