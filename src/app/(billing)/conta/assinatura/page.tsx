import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandLogo } from "@/components/brand";
import { formatBRL } from "@/lib/money";
import { formatMonths } from "@/lib/pricing";
import { formatTz } from "@/lib/tz";
import { getSession } from "@/server/auth";
import { type AccountAccess, getAccountAccess } from "@/server/services/account-access";
import { listPublicPlans, planCta } from "@/server/services/public-plans";

/**
 * A tela que a clínica vê quando o portão de acesso fecha.
 *
 * POR QUE ELA MORA EM (billing) E NÃO EM (app): o layout de (app) é justamente
 * quem redireciona para cá quando `getAccountAccess` nega. Se esta página
 * estivesse sob aquele layout, o redirecionamento apontaria para si mesmo e o
 * navegador entraria em laço — a conta bloqueada não veria tela nenhuma.
 * (billing) exige sessão (o próprio arquivo checa) mas não exige assinatura, e
 * é a única parte do produto onde as duas coisas se separam.
 *
 * Pela mesma razão esta página usa `getSession()` e NÃO `requireSession()`:
 * `requireSession` carrega o portão de acesso (é ele que segura as Server
 * Actions, que rodam antes de qualquer layout) e trocar um pelo outro aqui
 * mandaria esta tela para si mesma, em laço.
 *
 * A URL continua sendo /conta/assinatura porque, para quem usa, isto é a área
 * da conta; grupo de rotas não entra no endereço. Consequência a lembrar: criar
 * um (app)/conta/assinatura/page.tsx depois quebraria o build por conflito de
 * caminho, e o erro apontaria para o arquivo novo, não para este.
 */

export const metadata = { title: "Assinatura" };
export const dynamic = "force-dynamic";

/**
 * Endereço de suporte em env porque canal de atendimento muda sem deploy, e
 * porque a tela de conta bloqueada é o pior lugar possível para exibir um
 * contato desatualizado — é a única saída que a clínica tem daqui.
 */
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL?.trim() || "suporte@lumina.com.br";

type Situation = { title: string; lead: string; detail: string | null };

/**
 * A explicação em português de clínica, não de sistema. Nenhuma das três frases
 * culpa quem está lendo: a pessoa que abre esta tela normalmente não é quem
 * decidiu cancelar nem quem deixou o teste vencer, e mesmo quando é, ela já
 * sabe. O que ela precisa é do estado atual e do próximo passo.
 */
function describeSituation(
  access: Extract<AccountAccess, { allowed: false }>,
  timezone: string,
): Situation {
  // Data no fuso da clínica, não no do servidor: um teste que venceu às 23h54 de
  // 20/08 em São Paulo é 21/08 em UTC, e discutir com a cliente qual dos dois
  // dias vale é uma conversa que ninguém quer ter.
  const onDay = (date: Date) => formatTz(date, timezone, "d 'de' MMMM 'de' yyyy");

  switch (access.reason) {
    case "trial_expired":
      return {
        title: "Seu teste terminou",
        lead: "Está tudo guardado: agenda, clientes, atendimentos e financeiro continuam exatamente como você deixou. Para voltar a usar, é só ativar a assinatura.",
        detail: access.planName
          ? `O teste do plano ${access.planName} terminou em ${onDay(access.endedAt)}.`
          : `O período de teste terminou em ${onDay(access.endedAt)}.`,
      };
    case "canceled":
      return {
        title: "Sua assinatura foi encerrada",
        lead: "Nada foi apagado. Quando você reativar, a clínica volta do jeito que estava, com o mesmo histórico e a mesma agenda.",
        detail: access.endedAt
          ? `O acesso ficou disponível até ${onDay(access.endedAt)}.`
          : "O período contratado chegou ao fim.",
      };
    case "suspended":
      return {
        title: "Seu acesso está pausado",
        lead: "A nossa equipe pausou o acesso desta conta. Isso costuma se resolver em uma conversa rápida: fale com a gente e a gente destrava.",
        // O motivo é escrito pela nossa equipe sabendo que a clínica é afetada.
        // Esconder deixaria a pessoa sem saber o que perguntar no e-mail.
        detail: access.suspendedReason ? `O que ficou registrado: ${access.suspendedReason}` : null,
      };
  }
}

export default async function SubscriptionGatePage() {
  const ctx = await getSession();
  if (!ctx) redirect("/entrar");

  const access = await getAccountAccess(ctx.organizationId);
  // Sem esta linha a tela viraria uma armadilha ao contrário: quem resolveu a
  // pendência voltaria a este aviso toda vez que abrisse o endereço, ou o
  // deixaria salvo nos favoritos e nunca mais acharia o produto.
  if (access.allowed) redirect("/hoje");

  const situation = describeSituation(access, ctx.timezone);

  // Conta suspensa não recebe oferta de plano: assinar de novo não levanta uma
  // suspensão, e mostrar preço a quem já paga (ou já pagou) soa a cobrança
  // indevida. Para ela o único caminho é a conversa.
  const plan = access.reason === "suspended" ? null : (await listPublicPlans())[0];
  const cta = plan ? planCta(plan, "monthly") : null;

  const supportHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Assinatura da ${ctx.organizationName}`,
  )}`;

  /**
   * `planCta` é quem decide o botão do plano — mas o caminho que ele devolve
   * enquanto o checkout não está ligado é "comece um teste grátis", e teste é
   * exatamente o que acabou para quem está lendo esta tela. Fora do checkout
   * real, o botão vira conversa em vez de mandar a clínica para um cadastro
   * novo que criaria uma segunda conta vazia.
   */
  const action =
    cta?.kind === "checkout"
      ? { href: cta.href, label: cta.label }
      : { href: supportHref, label: "Falar com a gente para assinar" };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-6 py-12">
      <div className="mb-6">
        <BrandLogo compact />
      </div>

      <Card className="px-5 py-5">
        <h1 className="text-display text-ink">{situation.title}</h1>
        <p className="mt-1 text-caption text-ink-tertiary">{ctx.organizationName}</p>
        <p className="mt-3 text-body text-ink-secondary">{situation.lead}</p>
        {situation.detail ? (
          <p className="mt-4 rounded-control bg-surface px-3 py-2 text-label font-normal text-ink-secondary">
            {situation.detail}
          </p>
        ) : null}
      </Card>

      {plan ? (
        <Card className="mt-4 px-5 py-5">
          <h2 className="text-section">O que fazer agora</h2>
          <p className="mt-3 text-card text-ink">{plan.name}</p>
          {plan.tagline ? (
            <p className="mt-0.5 text-body text-ink-secondary">{plan.tagline}</p>
          ) : null}

          <p className="mt-3 flex items-baseline gap-1.5">
            <span className="text-metric tabular text-ink">{formatBRL(plan.monthlyPriceCents)}</span>
            <span className="text-label font-normal text-ink-secondary">por mês</span>
          </p>
          {plan.annual.savedCents > 0 ? (
            <p className="mt-1 text-caption text-ink-secondary">
              No anual, {formatBRL(plan.yearlyPriceCents)} por ano — o equivalente a{" "}
              {formatBRL(plan.annual.equivalentMonthlyCents)} por mês, uma economia de{" "}
              {formatMonths(plan.annual.months)}.
            </p>
          ) : null}

          {/* Cinco itens, não a lista inteira: aqui a pessoa quer voltar a
              trabalhar, não ler a página de vendas. O resto vira uma linha para
              não parecer que o plano encolheu. */}
          {plan.benefits.length > 0 ? (
            <>
              <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
                {plan.benefits.slice(0, 5).map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2 text-body text-ink-secondary">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
              {plan.benefits.length > 5 ? (
                <p className="mt-2 text-caption text-ink-tertiary">
                  E mais {plan.benefits.length - 5} recursos que já estavam no seu acesso.
                </p>
              ) : null}
            </>
          ) : null}

          <Button variant="primary" size="lg" className="mt-5 w-full" asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        </Card>
      ) : null}

      <Card className="mt-4 px-5 py-4">
        <h2 className="text-card text-ink">Falar com a gente</h2>
        <p className="mt-1 text-body text-ink-secondary">
          Escreva para <span className="text-ink">{SUPPORT_EMAIL}</span> contando o nome da sua
          clínica. Quem responde é quem faz o produto.
        </p>
        {/* Dois botões grandes para o MESMO mailto viram ruído — mas o botão só
            sai quando o cartão do plano já mostrou um acima. Na conta suspensa
            não existe cartão de plano, e este é o único caminho de saída. */}
        {plan && action.href === supportHref ? null : (
          <Button variant="secondary" size="md" className="mt-3" asChild>
            <a href={supportHref}>Enviar e-mail para o suporte</a>
          </Button>
        )}
      </Card>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-ink-tertiary">Você entrou como {ctx.userEmail}</p>
        <form action="/api/sair" method="post">
          <Button type="submit" variant="ghost" size="sm">
            Sair
          </Button>
        </form>
      </div>
    </main>
  );
}
