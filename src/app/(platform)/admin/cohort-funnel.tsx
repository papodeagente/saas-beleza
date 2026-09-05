import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { CohortFunnel } from "@/server/services/platform-metrics";

/**
 * Funil de aquisição por coorte semanal.
 *
 * Mora fora de page.tsx porque as duas caras do painel usam o mesmo bloco: com
 * assinatura ele é mais uma seção, sem assinatura ele é a única medida real de
 * tração que existe — antes do primeiro pagamento, ativação é o que separa
 * "cadastraram" de "estão usando".
 */

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/**
 * Mediana em texto. O número cru em horas ("0,3 h") não diz nada a quem lê o
 * painel; o que importa é a ordem de grandeza — no mesmo dia, em dois dias, em
 * duas semanas.
 */
function tempoAteAtivar(horas: number | null): string {
  if (horas === null) return "—";
  if (horas < 1) return "menos de 1 h";
  if (horas < 48) return `${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return `${dias} dias`;
}

/** "18/08 a 24/08" — a semana inteira, para ninguém confundir com um dia. */
function periodo(weekStartISO: string): string {
  const inicio = parseISO(weekStartISO);
  return `${format(inicio, "dd/MM", { locale: ptBR })} a ${format(addDays(inicio, 6), "dd/MM", { locale: ptBR })}`;
}

export function CohortFunnelSection({ funnel }: { funnel: CohortFunnel }) {
  const { totals, weeks } = funnel;
  const semanas = weeks.length;

  return (
    <section>
      <h2 className="text-section">Cadastro → ativação → pagamento</h2>
      <p className="mt-1 max-w-[76ch] text-caption text-ink-secondary">
        Cada linha acompanha as contas que <strong className="font-semibold">entraram</strong>{" "}
        naquela semana, até hoje — e não o que aconteceu naquela semana. Ativada é a conta que criou
        o primeiro agendamento na agenda: é o momento em que a clínica troca o caderno pelo sistema.
      </p>

      <Card className="mt-3">
        {totals.created === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            size="sm"
            title={
              semanas > 0
                ? `Nenhuma clínica se cadastrou nas últimas ${semanas} semanas`
                : "Nenhuma clínica se cadastrou ainda"
            }
            description="A primeira coorte aparece aqui na semana em que a primeira conta entrar. Sem cadastro não há taxa de ativação — e taxa sobre zero seria só uma linha de zeros fingindo ser um indicador."
          />
        ) : (
          <>
            <dl className="grid divide-y divide-line border-b border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Resumo
                rotulo="Contas criadas"
                valor={totals.created}
                detalhe={`nas últimas ${semanas} semanas`}
              />
              <Resumo
                rotulo="Ativaram"
                valor={totals.activated}
                detalhe={`${pct(totals.activationRate)} das criadas · mediana de ${tempoAteAtivar(totals.medianActivationHours)} até o primeiro agendamento`}
              />
              <Resumo
                rotulo="Pagantes"
                valor={totals.paying}
                detalhe={`${pct(totals.payingRate)} das criadas`}
              />
            </dl>

            {/* A tabela não encolhe: quatro colunas de número mais o período
                abaixo de 560px viram duas palavras por linha. Rola dentro do
                card em vez de arrastar a página inteira para o lado. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  {/* Largura fixa nas colunas de número: sem isso a tabela
                      espalha os quatro valores por 900px e comparar uma semana
                      com a de baixo vira exercício de vista. */}
                  <tr className="border-b border-line">
                    <Th className="text-left">Semana de cadastro</Th>
                    <Th className="w-[116px]">Criadas</Th>
                    <Th className="w-[132px]">Ativaram</Th>
                    <Th className="w-[132px]">Pagantes</Th>
                    <Th className="w-[132px]">Até ativar</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {weeks.map((semana) => {
                    const vazia = semana.created === 0;
                    return (
                      <tr key={semana.weekStartISO} className={cn(vazia && "text-ink-tertiary")}>
                        <td className="px-5 py-2.5 text-label whitespace-nowrap">
                          <span className={vazia ? "text-ink-tertiary" : "text-ink"}>
                            {periodo(semana.weekStartISO)}
                          </span>
                          {semana.inProgress ? (
                            <span className="ml-2 text-meta text-ink-tertiary">em curso</span>
                          ) : null}
                        </td>
                        <Td>{vazia ? "—" : semana.created}</Td>
                        <Td>
                          {vazia ? (
                            "—"
                          ) : (
                            <>
                              {semana.activated}
                              <span className="ml-1.5 text-meta text-ink-secondary">
                                {pct(semana.activated / semana.created)}
                              </span>
                            </>
                          )}
                        </Td>
                        <Td>
                          {vazia ? (
                            "—"
                          ) : (
                            <>
                              {semana.paying}
                              <span className="ml-1.5 text-meta text-ink-secondary">
                                {pct(semana.paying / semana.created)}
                              </span>
                            </>
                          )}
                        </Td>
                        <Td>{tempoAteAtivar(semana.medianActivationHours)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="border-t border-line px-5 py-3 text-meta leading-4 text-ink-secondary">
              A última semana ainda está aberta: a taxa dela sobe até a semana fechar. Comparação
              honesta é entre semanas fechadas.
            </p>
          </>
        )}
      </Card>
    </section>
  );
}

function Resumo({ rotulo, valor, detalhe }: { rotulo: string; valor: number; detalhe: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-caption text-ink-secondary">{rotulo}</dt>
      <dd>
        <span className="block text-metric tabular text-ink">{valor}</span>
        <span className="mt-0.5 block text-meta leading-4 text-ink-secondary">{detalhe}</span>
      </dd>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("px-5 py-2 text-right text-meta font-semibold text-ink-secondary", className)}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-5 py-2.5 text-right text-label tabular">{children}</td>;
}
