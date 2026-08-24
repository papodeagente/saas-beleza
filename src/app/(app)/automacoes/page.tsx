import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardList } from "@/components/ui/card";
import { PageBody, PageHeader, SectionLabel } from "@/components/app-shell";
import { requireSession } from "@/server/auth";
import { listAutomationRules, type AutomationTrigger } from "@/server/services/automation-service";
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

export default async function AutomationsPage() {
  const ctx = await requireSession();
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/hoje");
  const rules = await listAutomationRules(ctx);

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
                {rules.map((rule) => (
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
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <form action={toggleAutomationAction}>
                        <input type="hidden" name="id" value={rule.id} />
                        <input type="hidden" name="active" value={String(!rule.active)} />
                        <Button type="submit" variant="ghost">{rule.active ? "Pausar" : "Ativar"}</Button>
                      </form>
                      <form action={deleteAutomationAction}>
                        <input type="hidden" name="id" value={rule.id} />
                        <Button type="submit" variant="ghost">Remover</Button>
                      </form>
                    </div>
                  </li>
                ))}
              </CardList>
            ) : (
              <p className="px-4 py-8 text-center text-label text-ink-secondary">Nenhuma automação criada ainda.</p>
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
