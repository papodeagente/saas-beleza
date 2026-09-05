import Link from "next/link";
import { redirect } from "next/navigation";
import { formatBRL } from "@/lib/money";
import { formatMonths } from "@/lib/pricing";
import { getSession } from "@/server/auth";
import { getPublicPlanBySlug, listPublicPlans } from "@/server/services/public-plans";
import { formStamp, signupEnabled } from "@/server/services/signup";
import { AuthShell } from "../auth-shell";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Criar conta" };

/**
 * Fim do funil da landing: `?plano=<slug>&ciclo=<monthly|quarterly|yearly>`.
 *
 * O plano vem por SLUG e é relido do banco aqui — o cartão que a pessoa vê sai
 * do mesmo registro que a action vai cobrar, então preço na tela e preço na
 * assinatura não têm como divergir. Slug desconhecido (link velho, plano tirado
 * da vitrine) cai no primeiro plano público em vez de mostrar erro: quem chegou
 * com intenção de assinar não pode bater em beco.
 *
 * A moldura é a mesma do login de propósito: quem vem do site atravessa duas
 * telas seguidas e não pode sentir que trocou de produto no meio.
 */
export default async function CriarContaPage({
  searchParams,
}: {
  searchParams: Promise<{ plano?: string; ciclo?: string }>;
}) {
  if (await getSession()) redirect("/hoje");

  const params = await searchParams;
  const ciclo =
    params.ciclo === "yearly" ? ("yearly" as const) : params.ciclo === "quarterly" ? ("quarterly" as const) : ("monthly" as const);

  const escolhido = params.plano ? await getPublicPlanBySlug(params.plano) : null;
  const plano = escolhido ?? (await listPublicPlans())[0] ?? null;

  // Sem plano na vitrine não existe o que contratar, e o interruptor de
  // emergência precisa fechar a porta na PÁGINA também: deixar o formulário no
  // ar para ser recusado no envio só castiga quem já digitou tudo.
  if (!plano || !signupEnabled()) {
    return (
      <AuthShell>
        <h1 className="text-display text-ink">Cadastro fechado no momento</h1>
        <p className="mt-1.5 text-body text-ink-secondary">
          Estamos abrindo contas aos poucos. Fale com a gente que criamos a sua.
        </p>
        <p className="mt-6 border-t border-line pt-5 text-center text-label text-ink-secondary">
          Já tem conta?{" "}
          <Link
            href="/entrar"
            className="font-semibold text-accent underline underline-offset-4 transition-colors hover:text-accent-hover"
          >
            Entrar
          </Link>
        </p>
      </AuthShell>
    );
  }

  const anual = ciclo === "yearly";
  const trimestral = ciclo === "quarterly";
  const preco = anual ? plano.yearlyPriceCents : trimestral ? plano.quarterlyPriceCents : plano.monthlyPriceCents;
  const deal = anual ? plano.annual : trimestral ? plano.quarterly : null;

  return (
    <AuthShell>
      <h1 className="text-display text-ink">Comece o seu teste</h1>
      <p className="mt-1.5 text-body text-ink-secondary">
        {plano.trialDays} dias grátis, sem cartão. Sua clínica fica pronta para usar em um minuto.
      </p>

      <div className="mt-5 rounded-card border border-line bg-surface-raised px-4 py-3">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-label text-ink">Plano {plano.name}</span>
          <span className="tabular text-label text-ink">
            {formatBRL(preco)}
            <span className="ml-1 font-normal text-ink-secondary">
              {anual ? "por ano" : trimestral ? "por trimestre" : "por mês"}
            </span>
          </span>
        </p>
        <p className="mt-1 text-caption text-ink-tertiary">
          {deal
            ? `Sai por ${formatBRL(deal.equivalentMonthlyCents)} por mês — ${formatMonths(deal.months)} de economia. A cobrança só começa depois dos ${plano.trialDays} dias.`
            : `A cobrança começa depois dos ${plano.trialDays} dias de teste. Cancele quando quiser.`}
        </p>
      </div>

      <div className="mt-6">
        <SignupForm
          planSlug={plano.slug}
          cycle={ciclo}
          formIssuedAtMs={formStamp()}
          submitLabel={`Começar os ${plano.trialDays} dias grátis`}
        />
      </div>

      {/* Fora do <form>: quem já é cliente e caiu aqui pelo link do site precisa
          achar a saída sem tentar criar uma segunda conta com o mesmo e-mail. */}
      <p className="mt-6 border-t border-line pt-5 text-center text-label text-ink-secondary">
        Já tem conta?{" "}
        <Link
          href="/entrar"
          className="font-semibold text-accent underline underline-offset-4 transition-colors hover:text-accent-hover"
        >
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
