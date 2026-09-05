import { ArrowRight, Building2, Check, CreditCard, Layers, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CohortFunnel, LaunchReadiness } from "@/server/services/platform-metrics";
import { CohortFunnelSection } from "./cohort-funnel";

/**
 * Painel antes da primeira assinatura.
 *
 * Zerado e cheio de cartões, o painel normal é indistinguível de um painel
 * quebrado — e ainda esconde a única coisa que importa agora, que é o caminho
 * para a primeira conta. Esta tela some sozinha: basta existir uma assinatura.
 *
 * Cada item abaixo lê o estado REAL do banco. Nenhum vem marcado por padrão.
 */

type Passo = {
  titulo: string;
  pronto: boolean;
  descricaoPronto: string;
  descricaoPendente: string;
  href: string;
  acao: string;
  icone: React.ComponentType<{ className?: string }>;
};

export function PreLaunch({
  readiness,
  cohorts,
}: {
  readiness: LaunchReadiness;
  /**
   * Antes da primeira venda o funil é o ÚNICO indicador honesto da tela: MRR e
   * retenção só existem depois que alguém paga, mas cadastro e ativação já
   * dizem se o produto está sendo usado.
   */
  cohorts: CohortFunnel;
}) {
  const passos: Passo[] = [
    {
      titulo: "Planos",
      pronto: readiness.activePlans > 0,
      descricaoPronto: `${readiness.activePlans} ${readiness.activePlans === 1 ? "plano ativo" : "planos ativos"}, com preço mensal e anual.`,
      descricaoPendente: "Uma conta precisa de um plano para existir, mesmo começando em teste.",
      href: "/admin/planos",
      acao: readiness.activePlans > 0 ? "Revisar planos" : "Cadastrar plano",
      icone: Layers,
    },
    {
      titulo: "Cobrança",
      pronto: readiness.liveProviders > 0,
      descricaoPronto: "Meio de pagamento ligado e com o segredo do webhook guardado.",
      descricaoPendente:
        readiness.configuredProviders > 0
          ? "O provedor está cadastrado, mas falta ligar e guardar o segredo do webhook."
          : "Sem meio de pagamento, dá para cadastrar contas e cobrar por fora — o painel só não concilia sozinho.",
      href: "/admin/pagamentos",
      acao: readiness.liveProviders > 0 ? "Ver cobrança" : "Configurar cobrança",
      icone: CreditCard,
    },
    {
      titulo: "Quem administra",
      pronto: readiness.platformAdmins > 0,
      descricaoPronto: `${readiness.platformAdmins} ${readiness.platformAdmins === 1 ? "pessoa tem" : "pessoas têm"} acesso a este painel.`,
      descricaoPendente: "Ninguém administra a plataforma.",
      href: "/admin/administradores",
      acao: "Gerenciar acesso",
      icone: ShieldCheck,
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="px-6 py-6">
        <p className="text-section">Receita recorrente mensal</p>
        <p className="mt-2 text-[38px] font-extrabold leading-[44px] tracking-[-0.02em] tabular text-ink">
          R$ 0,00
        </p>
        <p className="mt-2 max-w-[56ch] text-body text-ink-secondary">
          Nenhuma clínica contratou ainda. MRR, cancelamento e retenção começam a ser calculados na
          primeira assinatura — até lá ficam fora da tela, porque um indicador zerado não é um
          indicador.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button asChild variant="primary" size="md">
            <Link href="/admin/contas/nova">
              <Building2 />
              Cadastrar a primeira conta
            </Link>
          </Button>
          {readiness.organizations > 0 ? (
            <Link
              href="/admin/contas"
              className="flex items-center gap-1.5 text-label text-accent transition-colors hover:text-accent-hover"
            >
              Ver {readiness.organizations === 1 ? "a clínica que já existe" : `as ${readiness.organizations} clínicas que já existem`}
              <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </Card>

      <CohortFunnelSection funnel={cohorts} />

      <section>
        <h2 className="text-section">O que já está de pé</h2>
        <Card className="mt-3 divide-y divide-line">
          {passos.map((passo) => (
            <div key={passo.titulo} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  passo.pronto
                    ? "bg-positive/10 text-positive"
                    : "bg-surface-sunken text-ink-tertiary",
                )}
              >
                {passo.pronto ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <passo.icone className="size-4" aria-hidden />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-label text-ink">
                  {passo.titulo}
                  <span className="sr-only">{passo.pronto ? " — pronto" : " — pendente"}</span>
                </p>
                <p className="mt-0.5 text-caption text-ink-secondary">
                  {passo.pronto ? passo.descricaoPronto : passo.descricaoPendente}
                </p>
              </div>

              <Link
                href={passo.href}
                className="flex items-center gap-1.5 text-label text-accent transition-colors hover:text-accent-hover"
              >
                {passo.acao}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
