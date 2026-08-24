import { MessageSquareHeart } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader, SectionLabel } from "@/components/app-shell";
import { formatTz } from "@/lib/tz";
import { requireSession } from "@/server/auth";
import {
  type AutomationDispatchRow,
  type AutomationTrigger,
  listAutomationRules,
  listRecentDispatches,
} from "@/server/services/automation-service";
import { AutomationForm } from "./automation-form";
import { deleteAutomationAction, toggleAutomationAction } from "./actions";

export const metadata = { title: "Automações" };
export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<AutomationTrigger, (days: number) => string> = {
  appointment_created: () => "Imediatamente após criar o agendamento",
  before_appointment: (days) => `${days} ${days === 1 ? "dia" : "dias"} antes do agendamento`,
  appointment_day: () => "No dia do agendamento",
  after_appointment: (days) => `${days} ${days === 1 ? "dia" : "dias"} após o atendimento`,
  after_purchase: (days) => `${days} ${days === 1 ? "dia" : "dias"} após a última compra`,
  birthday_before: (days) => `${days} ${days === 1 ? "dia" : "dias"} antes do aniversário`,
  birthday_day: () => "No dia do aniversário",
};

const SITUACAO: Record<AutomationDispatchRow["status"], { rotulo: string; tom: "positive" | "danger" | "neutral" | "info" }> = {
  sent: { rotulo: "Enviada", tom: "positive" },
  failed: { rotulo: "Não enviada", tom: "danger" },
  skipped: { rotulo: "Não enviada", tom: "neutral" },
  processing: { rotulo: "Enviando", tom: "info" },
};

export default async function AutomationsPage() {
  const ctx = await requireSession();
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/hoje");
  const [rules, dispatches] = await Promise.all([listAutomationRules(ctx), listRecentDispatches(ctx)]);

  // Um gatilho só aceita uma regra ativa. Botão que só existe para dar erro é
  // pior que botão ausente, então a tela não oferece a ativação que o serviço
  // vai recusar — e diz por quê.
  const gatilhosOcupados = new Map(rules.filter((r) => r.active).map((r) => [r.trigger, r.name]));

  return (
    <div>
      <PageHeader title="Automações" description="Reduza faltas e traga clientes de volta no momento certo." />
      <PageBody className="space-y-8">
        <section aria-labelledby="nova-automacao">
          <SectionLabel><span id="nova-automacao">Nova automação</span></SectionLabel>
          <Card className="mt-2.5 p-4"><AutomationForm /></Card>
        </section>

        <section aria-labelledby="regras-ativas">
          <SectionLabel><span id="regras-ativas">Suas automações</span></SectionLabel>
          <Card className="mt-2.5">
            {rules.length ? (
              <CardList>
                {rules.map((rule) => {
                  const ocupadoPor = rule.active ? null : gatilhosOcupados.get(rule.trigger);
                  return (
                  <li key={rule.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-label font-semibold text-ink">{rule.name}</span>
                        <Badge tone={rule.active ? "positive" : "neutral"}>{rule.active ? "Ativa" : "Pausada"}</Badge>
                      </div>
                      <p className="mt-1 text-caption text-ink-secondary">
                        {TRIGGER_LABEL[rule.trigger](rule.daysOffset)}{rule.trigger === "appointment_created" ? "" : `, às ${rule.sendTime.slice(0, 5)}`}
                      </p>
                      <p className="mt-1 line-clamp-2 text-caption text-ink-tertiary">{rule.messageTemplate}</p>
                      {ocupadoPor ? (
                        <p className="mt-1 text-caption text-ink-tertiary">
                          Para ativar esta, pause “{ocupadoPor}”: duas automações no mesmo momento mandam a mesma mensagem duas vezes.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <form action={toggleAutomationAction}>
                        <input type="hidden" name="id" value={rule.id} />
                        <input type="hidden" name="active" value={String(!rule.active)} />
                        <Button type="submit" variant="ghost" disabled={Boolean(ocupadoPor)}>
                          {rule.active ? "Pausar" : "Ativar"}
                        </Button>
                      </form>
                      <form action={deleteAutomationAction}>
                        <input type="hidden" name="id" value={rule.id} />
                        <Button type="submit" variant="ghost">Remover</Button>
                      </form>
                    </div>
                  </li>
                  );
                })}
              </CardList>
            ) : (
              /* "Nenhuma automação criada ainda." informava o vazio e parava
                 aí. Quem chega nesta tela pela primeira vez precisa saber o que
                 a automação faz por ela e para onde olhar — o formulário está
                 logo acima, então a orientação aponta para ele em vez de
                 repetir um botão que duplicaria a ação da tela. */
              <EmptyState
                icon={MessageSquareHeart}
                size="sm"
                title="Nenhuma automação ainda"
                description="Automação é o lembrete que sai sozinho no WhatsApp: confirmação na véspera, agradecimento no dia seguinte, convite para voltar. Monte a primeira no formulário acima."
              />
            )}
          </Card>
        </section>

        <section aria-labelledby="ultimos-disparos">
          <SectionLabel><span id="ultimos-disparos">Últimos disparos</span></SectionLabel>
          <Card className="mt-2.5">
            {dispatches.length ? (
              <CardList>
                {dispatches.map((disparo) => {
                  const situacao = SITUACAO[disparo.status];
                  const quando = disparo.sentAt ?? disparo.scheduledFor;
                  return (
                    <li key={disparo.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-label font-semibold text-ink">{disparo.customerName}</span>
                        <Badge tone={situacao.tom}>{situacao.rotulo}</Badge>
                        {disparo.attempts > 1 ? (
                          <span className="text-caption text-ink-tertiary">{disparo.attempts} tentativas</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-caption text-ink-secondary">
                        {formatTz(quando, ctx.timezone, "dd/MM 'às' HH:mm")} · {disparo.ruleName}
                      </p>
                      {disparo.error ? (
                        <p className="mt-1 text-caption text-danger">{disparo.error}</p>
                      ) : null}
                      {/* Detalhe cru do provedor: dobrado por padrão porque não é
                          para a dona do salão, é para quem for investigar. */}
                      {disparo.errorDetail ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-caption text-ink-tertiary">Detalhes técnicos</summary>
                          <p className="mt-1 break-words text-caption text-ink-tertiary">{disparo.errorDetail}</p>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </CardList>
            ) : (
              <p className="px-4 py-8 text-center text-label text-ink-secondary">Nenhuma mensagem automática enviada ainda.</p>
            )}
          </Card>
        </section>

        <Card inset className="px-4 py-3">
          <p className="text-caption text-ink-secondary">
            Lembretes de agenda são operacionais. Mensagens para trazer clientes de volta só são enviadas a quem autorizou comunicações de marketing.
          </p>
        </Card>
      </PageBody>
    </div>
  );
}
