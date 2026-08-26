"use client";

import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus, Check, MapPin, Phone, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { precoPartido } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand";
import { type Esmalte, type Laca, esmalteDe, lacaDe } from "./esmaltes";
import { afinarHorarios } from "./horarios";
import { baixarICS, montarICS } from "./ics";
import {
  type BookingConfirmation,
  publicAvailableDaysAction,
  publicBookingAction,
  publicSlotsAction,
  trackBookingAccessAction,
} from "./actions";
import type { PublicSlot } from "@/server/services/public-booking-service";

type Service = {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  categoryName: string | null;
};

type Branch = { id: number; name: string; address: string | null; phone: string | null };

/**
 * "dia" e "hora" eram duas telas. Viraram uma só: no celular a escolha do dia
 * custava 900px de rolagem e mais um toque para depois descobrir que aquele dia
 * não tinha o horário que servia. Agora a faixa de dias fica fixa no topo do
 * passo e os horários trocam embaixo dela.
 */
type Step = "service" | "branch" | "when" | "identify" | "done";

/** Abreviação de 3 letras: o nome por extenso vaza do chip de data. */
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Campo de formulário DESTA página — 16px, e o número é a razão de existir.
 *
 * O `Input` do produto vem em `text-label`, 13px. Abaixo de 16px o Safari do
 * iPhone dá zoom sozinho ao focar o campo: a página inteira reescala, o botão
 * de confirmar sai de vista e a cliente precisa se reorientar no exato passo em
 * que desistir custa menos que continuar. No painel interno o zoom é aceitável
 * — quem opera está sentado e conhece a tela. Aqui não é.
 *
 * `font-normal` desfaz o peso 600 que vem junto do `text-card`: o que se quer
 * dele é só o corpo de 16px, não a ênfase.
 *
 * `h-14` e não `h-12`: 56px de alvo pelo preço de 8px de tela, com o mesmo
 * corpo de 16px. E `border-cartao-linha` porque o fio lavanda do produto,
 * correto sobre o canvas do painel, corta o osso com um risco cinza.
 */
const CAMPO =
  "h-14 border-cartao-fio text-card font-normal";

export function BookingFlow({
  slug,
  organizationName,
  branches,
  services,
}: {
  slug: string;
  organizationName: string;
  branches: Branch[];
  services: Service[];
}) {
  /**
   * Clínica com UM serviço não tem passo 1.
   *
   * Foi nessa conta que o dono olhou a página e a chamou de feia, e com razão:
   * "O que você quer fazer?" seguido de uma única opção é uma pergunta que já
   * tem resposta. A regra é a mesma que a unidade única já seguia — escolher
   * por alguém o que não tem escolha.
   *
   * Derivado no `useState`, e não num efeito: em efeito a cliente veria um
   * quadro do passo 1 antes de ele sumir.
   */
  const servicoUnico = services.length === 1 ? services[0] : null;
  const [service, setService] = useState<Service | null>(servicoUnico);
  const [branch, setBranch] = useState<Branch | null>(branches.length === 1 ? branches[0] : null);
  const [step, setStep] = useState<Step>(
    servicoUnico ? (branches.length > 1 ? "branch" : "when") : "service",
  );
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [availableDays, setAvailableDays] = useState<Array<{ dateISO: string; slotCount: number }> | null>(null);
  const [loadingDays, startDaysTransition] = useTransition();
  const [loadingSlots, startSlotsTransition] = useTransition();
  const [slot, setSlot] = useState<PublicSlot | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [mostrarEmail, setMostrarEmail] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const storageKey = `agenda-visitor:${slug}`;
    let visitorToken = window.localStorage.getItem(storageKey);
    if (!visitorToken) {
      visitorToken = crypto.randomUUID();
      window.localStorage.setItem(storageKey, visitorToken);
    }
    void trackBookingAccessAction({ slug, visitorToken });
  }, [slug]);

  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(new Date(), i)), []);


  /**
   * Ao carregar os dias, o primeiro dia livre já é escolhido e seus horários
   * já são buscados. É um toque a menos, e resolve o caso mais comum de todos:
   * a cliente quer o horário mais próximo possível.
   */
  function loadDays(next: { service: Service | null; branch: Branch | null }) {
    setAvailableDays(null);
    setSlot(null);
    setSlots(null);
    buscarDias(next);
  }

  /**
   * Só a ida ao servidor, sem os três `set` de limpeza.
   *
   * A separação existe para o caminho da montagem: numa página que já abre em
   * "quando", limpar estado que ainda é nulo é escrita síncrona dentro de
   * efeito — o que o lint proíbe, com razão, porque é o mesmo gesto que produz
   * render em cascata quando o alvo NÃO está limpo.
   */
  function buscarDias(next: { service: Service | null; branch: Branch | null }) {
    if (!next.service) return;
    startDaysTransition(async () => {
      const rows = await publicAvailableDaysAction({
        slug,
        serviceId: next.service!.id,
        branchId: next.branch?.id,
        dateISOs: days.map((date) => format(date, "yyyy-MM-dd")),
      });
      setAvailableDays(rows);
      const primeiro = rows[0];
      if (primeiro) {
        setDay(primeiro.dateISO);
        loadSlots({ ...next, day: primeiro.dateISO });
      }
    });
  }

  /**
   * A página que abre direto em "quando" precisa que a busca dos dias comece
   * sozinha.
   *
   * `loadDays` só era chamado dentro de `chooseService`; abrindo em "when" com
   * `availableDays` nulo e `loadingDays` falso, a tela caía no ramo final e
   * anunciava "nenhum dia livre nas próximas três semanas" para sempre — numa
   * agenda cheia.
   */
  const perguntaRef = useRef<HTMLHeadingElement>(null);
  /**
   * Na PRIMEIRA pintura ninguém roubou o foco de ninguém — mover para a
   * pergunta ali seria rolar a página de quem acabou de chegar. Só a partir da
   * segunda troca.
   */
  const jaTrocou = useRef(false);
  useEffect(() => {
    if (!jaTrocou.current) {
      jaTrocou.current = true;
      return;
    }
    perguntaRef.current?.focus({ preventScroll: true });
  }, [step]);

  const montado = useRef(false);
  useEffect(() => {
    if (montado.current) return;
    montado.current = true;
    if (servicoUnico && branches.length <= 1) buscarDias({ service: servicoUnico, branch });
    // Uma vez na montagem: as dependências reais são as props iniciais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Carregar horários é sempre consequência de uma escolha do cliente
   * (serviço, unidade ou data), então roda numa transição — o indicador de
   * carregamento vem do React, sem efeito nem render em cascata.
   */
  function loadSlots(next: { service: Service | null; branch: Branch | null; day: string }) {
    setSlot(null);
    if (!next.service) {
      setSlots(null);
      return;
    }
    startSlotsTransition(async () => {
      const rows = await publicSlotsAction({
        slug,
        serviceId: next.service!.id,
        dateISO: next.day,
        branchId: next.branch?.id,
      });
      setSlots(rows);
    });
  }

  function chooseService(value: Service) {
    setService(value);
    if (branches.length > 1) {
      setStep("branch");
      return;
    }
    setStep("when");
    loadDays({ service: value, branch });
  }

  function chooseBranch(value: Branch) {
    setBranch(value);
    setStep("when");
    loadDays({ service, branch: value });
  }

  function chooseDay(value: string) {
    setDay(value);
    loadSlots({ service, branch, day: value });
  }

  function submit() {
    if (!service || !slot) return;
    setError(null);
    startTransition(async () => {
      const result = await publicBookingAction({
        slug,
        serviceId: service.id,
        startsAt: slot.startsAt,
        professionalId: slot.professionalId,
        branchId: slot.branchId,
        resourceId: slot.resourceId,
        name,
        phone,
        email,
        consentMarketing,
      });
      if (result.ok) {
        setConfirmation(result.confirmation);
        setStep("done");
      } else {
        setError(result.error);
        // O horário pode ter sido ocupado enquanto o cliente preenchia os dados
        const fresh = await publicSlotsAction({
          slug,
          serviceId: service.id,
          dateISO: day,
          branchId: branch?.id,
        });
        setSlots(fresh);
        if (!fresh.some((s) => s.startsAt === slot.startsAt)) {
          setSlot(null);
          setStep("when");
        }
      }
    });
  }

  // Horários únicos por etiqueta (o cliente escolhe hora, não profissional)
  // A MESMA regra que o servidor usou para contar os horários do dia na fita.
  // Enquanto eram duas, a tela anunciava 31 e desenhava 16.
  const times = afinarHorarios(
    slots ? [...new Map(slots.map((s) => [s.label, s])).entries()].map(([, value]) => value) : [],
    (s) => s.label,
  );
  const manha = times.filter((s) => Number(s.label.slice(0, 2)) < 12);
  const tarde = times.filter((s) => {
    const h = Number(s.label.slice(0, 2));
    return h >= 12 && h < 18;
  });
  const noite = times.filter((s) => Number(s.label.slice(0, 2)) >= 18);
  const dayDate = days.find((d) => format(d, "yyyy-MM-dd") === day) ?? days[0];
  /**
   * A régua da barrinha de vagas: o dia mais cheio da faixa.
   *
   * E a barrinha só existe quando os dias DIFEREM entre si. Numa agenda que
   * ainda não tem nada marcado, catorze dias com a mesma lotação desenhavam
   * catorze barras idênticas — gráfico sem variância é enfeite, e enfeite que
   * finge ser informação é pior do que nada.
   */
  const lotacoes = (availableDays ?? []).map((d) => d.slotCount);
  const maiorDia = Math.max(1, ...lotacoes);
  const mostrarLotacao = new Set(lotacoes).size > 1;
  const esmalte = esmalteDe(service?.categoryName);
  const unidade = branch ?? (branches.length === 1 ? branches[0] : null);
  const laca = lacaDe(organizationName);

  /**
   * A fachada encolhe do passo "quando" em diante — mas só quando existiu um
   * passo 1. Com serviço único, "quando" é a PRIMEIRA tela que a cliente vê:
   * abri-la com o nome da casa reduzido seria repetir a queixa que originou
   * este redesenho, a de não haver prova nenhuma de que aquele lugar existe.
   */
  const fachadaCompacta = (step === "when" || step === "identify") && services.length > 1;

  /**
   * Quantos passos esta clínica realmente tem.
   *
   * A trilha antiga dizia "3" sempre, e mentia nas duas pontas: com serviço
   * único são 2, com mais de uma unidade são 4.
   */
  const passos = passosDaClinica(services.length, branches.length);
  const rotuloDoPasso =
    step === "service"
      ? "Serviço"
      : step === "branch"
        ? "Unidade"
        : step === "when"
          ? "Dia e hora"
          : "Seus dados";
  /** Zero quando o passo aberto não é um dos que esta clínica anuncia. */
  const posicaoDoPasso = passos.indexOf(rotuloDoPasso) + 1;

  if (step === "done" && confirmation && service && slot) {
    return (
      <Vitrine
        organizationName={organizationName}
        unidade={unidade}
        laca={laca}
        compacta={false}
        barraFixa={false}
        contato={false}
      >
        <Bilhete
          confirmation={confirmation}
          esmalte={esmalte}
          organizationName={organizationName}
          service={service}
          slot={slot}
        />
      </Vitrine>
    );
  }

  return (
    <Vitrine
      organizationName={organizationName}
      unidade={unidade}
      laca={laca}
      compacta={fachadaCompacta}
      barraFixa={step === "when" && slot !== null}
    >
      <div key={step} className="animate-passo min-w-0">
        <div className="min-w-0">
          {/* Uma linha no lugar de três traços: diz em que passo a cliente está
              e quantos existem NESTA clínica, sem prometer etapa que não há. */}
          {/*
            A contagem só sai quando o passo aberto ESTÁ na lista.

            Clínica sem serviço publicado abre em "service", e "Serviço" não
            entra em `passos` (a lista só o inclui quando há mais de um): o
            `indexOf` devolvia -1 e a primeira tela da cliente dizia
            "0 DE 2 · SERVIÇO" acima de "Nada disponível para agendar online".
          */}
          <p role="status" aria-live="polite" className="text-eyebrow text-ink-secondary">
            {posicaoDoPasso > 0 ? `${posicaoDoPasso} de ${passos.length} · ` : ""}
            {rotuloDoPasso}
          </p>
          {/* O recibo.
              Cada escolha feita encolhe para uma linha e continua na tela, com
              o botão que a desfaz. É o que substituiu o "Voltar": trocar o
              serviço é uma ideia que a cliente tem, voltar uma tela é uma
              instrução de navegação — e o recibo ainda responde, no meio do
              caminho, o que ela escolheu e quanto vai custar. */}
          {service && step !== "service" ? (
            <LinhaRecibo
              esmalte={esmalte}
              principal={service.name}
              secundario={`${duracao(service.durationMin)} · ${precoPartido(service.priceCents).join(" ")}`}
              onTrocar={services.length > 1 ? () => setStep("service") : undefined}
            />
          ) : null}
          {branch && branches.length > 1 && step !== "service" && step !== "branch" ? (
            <LinhaRecibo
              principal={branch.name}
              secundario={branch.address ?? undefined}
              onTrocar={branches.length > 1 ? () => setStep("branch") : undefined}
            />
          ) : null}
          {slot && step === "identify" ? (
            <LinhaRecibo
              principal={`${maiuscula(format(new Date(slot.startsAt), "EEEE, d 'de' MMMM", { locale: ptBR }))} às ${slot.label}`}
              secundario={`com ${slot.professionalName}`}
              onTrocar={() => setStep("when")}
            />
          ) : null}

          {/*
            A pergunta do passo recebe o foco a cada troca.

            Como a árvore é remontada por `key={step}`, o foco caía no BODY: a
            cliente que navega por teclado ou por leitor de tela perdia o lugar
            e não ouvia nada — a tela inteira mudava em silêncio. Com
            `tabIndex={-1}` ela é focável por código sem entrar na ordem de
            tabulação, e o `aria-live` do rótulo do passo anuncia onde parou.
          */}
          <h2 ref={perguntaRef} tabIndex={-1} className="mt-4 text-ask text-ink outline-none">
            {step === "service"
              ? "O que você quer fazer?"
              : step === "branch"
                ? "Em qual unidade?"
                : step === "when"
                  ? "Quando fica bom para você?"
                  : "Só falta você se identificar"}
          </h2>

          {/* 1. Serviço — uma carta de preços, que é como salão mostra serviço. */}
          {step === "service" ? (
            <div className="mt-5 space-y-6">
              {groupByCategory(services).map(([category, list]) => {
                const tom = esmalteDe(category);
                return (
                  <section key={category ?? "sem-categoria"}>
                    <h3 className="mb-2.5 flex items-center gap-2">
                      <Postica esmalte={tom} className="h-[19px] w-[14px]" brilho={false} />
                      <span className="text-card text-ink">{category ?? "Serviços"}</span>
                    </h3>
                    {/*
                      Placas separadas, e não uma lista com filetes: numa carta
                      de salão cada serviço é um item, não uma linha de tabela
                      de configurações. O fundo de cada placa é o cartão tingido
                      no esmalte da própria categoria — 8% é o bastante para o
                      olho agrupar sem que a cor vire fundo colorido.

                      Sem seta no fim da linha: a afordância é a placa inteira,
                      com a postiça, o preço em peso 800 e o estado pressionado.
                      Seta cinza à direita é vocabulário de tela de ajustes.
                    */}
                    <ul className="space-y-3">
                      {list.map((item) => {
                        const [simbolo, numero] = precoPartido(item.priceCents);
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => chooseService(item)}
                              style={
                                {
                                  "--esmalte": tom.fill,
                                  "--aro": tom.aro,
                                  // A tintura vai no `style`, e não numa classe
                                  // de propriedade arbitrária: como classe ela
                                  // empatava com `bg-cartao` na cascata e
                                  // PERDIA — medido, as seis placas saíam com o
                                  // mesmo osso #fbf7f2 e a cor da categoria
                                  // nunca chegava à tela. No style ela sempre
                                  // vence, e navegador sem `color-mix` ignora a
                                  // linha e cai no osso, que é o desejado.
                                  backgroundColor: `color-mix(in oklab, ${tom.fill} 9%, var(--color-cartao))`,
                                } as React.CSSProperties
                              }
                              className="flex w-full items-start gap-3.5 rounded-[14px] bg-cartao px-4 py-3.5 text-left ring-1 ring-cartao-fio transition-transform duration-100 hover:ring-[color-mix(in_oklab,var(--aro)_45%,transparent)] active:translate-y-px active:scale-[.985]"
                            >
                              <Postica esmalte={tom} className="mt-0.5 h-[38px] w-[28px]" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-card text-ink">{item.name}</span>
                                {item.description ? (
                                  <span className="mt-0.5 line-clamp-2 block text-body text-ink-secondary">
                                    {item.description}
                                  </span>
                                ) : null}
                                {/* A guia pontilhada liga a duração ao preço, como
                                    no cardápio: sem ela os dois flutuam soltos nas
                                    pontas e o olho não sabe que são o mesmo par. */}
                                <span className="mt-2 flex items-baseline">
                                  <span className="shrink-0 text-body text-ink-secondary">
                                    {duracao(item.durationMin)}
                                  </span>
                                  <span aria-hidden className="guia" />
                                  <span className="shrink-0 text-price tabular text-ink">
                                    <span className="text-ink-secondary">{simbolo}&nbsp;</span>
                                    {numero}
                                  </span>
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {services.length === 0 ? (
                <Vazio
                  titulo="Nada disponível para agendar online"
                  detalhe={`${organizationName} ainda não publicou serviços para agendamento pelo site.`}
                />
              ) : null}
            </div>
          ) : null}

          {/* 2. Unidade */}
          {step === "branch" ? (
            // Mesma placa da carta de serviços, sem postiça (unidade não tem
            // esmalte) e sem seta: a afordância é a placa, não um chevron.
            <ul className="mt-5 space-y-3">
              {branches.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => chooseBranch(item)}
                    className="w-full rounded-[14px] bg-cartao px-4 py-4 text-left ring-1 ring-cartao-fio transition-transform duration-100 hover:bg-cartao-sunken active:translate-y-px active:scale-[.985]"
                  >
                    <span className="block text-card text-ink">{item.name}</span>
                    {item.address ? (
                      <span className="mt-1 block text-body text-ink-secondary">{item.address}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* 3. Dia e hora, na mesma tela. */}
          {step === "when" ? (
            <div className="mt-5">
              {loadingDays ? (
                <div className="trilha -mx-5 flex gap-2 overflow-hidden px-5 sm:mx-0 sm:px-0">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Fantasma key={i} className="h-[78px] w-[58px] shrink-0 rounded-[14px]" />
                  ))}
                </div>
              ) : availableDays?.length ? (
                <>
                  <p className="mb-2 text-section">{format(dayDate, "MMMM", { locale: ptBR })}</p>
                  {/* A máscara desfaz o corte seco no fim da faixa: sem ela o
                      último cartão fica cerrado ao meio pela borda e lê como
                      defeito de renderização, não como "tem mais para o lado". */}
                  <div
                    role="group"
                    aria-label="Dias com horário livre"
                    className="trilha -mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [mask-image:linear-gradient(to_right,#000_0,#000_calc(100%-40px),transparent_100%)] sm:mx-0 sm:px-0"
                  >
                    {availableDays.map((available, i) => {
                      const date = days.find((item) => format(item, "yyyy-MM-dd") === available.dateISO)!;
                      const ativo = available.dateISO === day;
                      /**
                       * A vira-mês é a única marca de mês dentro da faixa:
                       * repetir "ago" em catorze cartões era ruído, não
                       * informação.
                       *
                       * A comparação é com o cartão ANTERIOR DA LISTA, e não
                       * com o dia 1º: `getPublicAvailableDays` devolve só os
                       * dias que têm vaga, então a faixa pula datas (25, 27,
                       * 30...) e o dia 1º frequentemente não está nela. Marcar
                       * "dia === 1" deixaria a virada de setembro sem nenhum
                       * aviso, que é justamente onde a cliente se perde.
                       */
                      const anteriorISO = i > 0 ? availableDays[i - 1].dateISO : null;
                      const viraMes =
                        anteriorISO !== null && anteriorISO.slice(0, 7) !== available.dateISO.slice(0, 7);
                      return (
                        <button
                          key={available.dateISO}
                          type="button"
                          onClick={() => chooseDay(available.dateISO)}
                          aria-pressed={ativo}
                          // O chip mostra "qui 28"; quem ouve a página precisa
                          // da data por extenso e de quantas vagas restam.
                          aria-label={`${format(date, "EEEE, d 'de' MMMM", { locale: ptBR })} — ${available.slotCount} ${available.slotCount === 1 ? "horário livre" : "horários livres"}`}
                          style={{ "--aro": esmalte.aro } as React.CSSProperties}
                          className={cn(
                            "relative flex h-[78px] w-[58px] shrink-0 snap-start flex-col items-center justify-center rounded-[14px] transition-colors",
                            ativo
                              ? "bg-accent text-white"
                              : "bg-cartao text-ink ring-1 ring-cartao-fio hover:bg-cartao-sunken",
                          )}
                        >
                          <span
                            className={cn(
                              "text-meta uppercase tracking-[0.06em]",
                              ativo ? "text-white" : "text-ink-secondary",
                            )}
                          >
                            {WEEKDAY_SHORT[date.getDay()]}
                          </span>
                          <span className="text-title tabular">{format(date, "d")}</span>
{/*
                            Quanto o dia tem de vaga, sem número: uma barrinha
                            que cresce. Dia lotado e dia com uma sobra eram
                            idênticos na fita, e a cliente só descobria isso
                            depois de tocar.

                            A largura é RELATIVA ao dia mais cheio da faixa, e
                            não uma escala absoluta: com "3px por vaga" toda
                            barra saturava no teto e as catorze ficavam
                            exatamente iguais — enfeite no lugar de informação.

                            É o `aro` do esmalte e não o `fill`: medido, o fill
                            a 45% dá de 1,11:1 a 2,39:1 contra o cartão e
                            reprova o limiar de 3:1 de elemento gráfico.
                          */}
                          {mostrarLotacao ? (
                            <span
                              aria-hidden
                              className="mt-1 h-[3px] rounded-pill"
                              style={{
                                width: `${Math.round(18 + 42 * (available.slotCount / maiorDia))}%`,
                                backgroundColor: ativo ? "rgb(255 255 255 / 0.72)" : "var(--aro)",
                              }}
                            />
                          ) : null}
                          {/* A linha do mês existe em TODOS os cartões, vazia na
                              maioria. Renderizá-la só na virada empurrava o
                              número para cima naquele cartão e desalinhava a
                              fita inteira — o dia 1º ficava meio dedo mais alto
                              que o 31 ao lado dele. */}
                          <span
                            aria-hidden
                            className={cn("text-meta", ativo ? "text-white" : "text-accent")}
                          >
                            {viraMes ? format(date, "MMM", { locale: ptBR }) : " "}
                          </span>
                                                  </button>
                      );
                    })}
                  </div>

                  <p role="status" aria-live="polite" className="sr-only">
                    {loadingSlots
                      ? "Carregando horários"
                      : times.length === 0
                        ? "Nenhum horário livre neste dia"
                        : `${times.length} horários disponíveis`}
                  </p>

                  <div className="mt-6 space-y-5">
                    {loadingSlots ? (
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                        {Array.from({ length: 12 }).map((_, i) => (
                          <Fantasma key={i} className="h-[52px] rounded-[10px]" />
                        ))}
                      </div>
                    ) : times.length === 0 ? (
                      <Vazio
                        titulo="Nenhum horário livre neste dia"
                        detalhe="Escolha outra data na faixa acima."
                      />
                    ) : (
                      <>
                        {manha.length > 0 ? (
                          <TimeGroup label="Manhã" slots={manha} selected={slot} onSelect={setSlot} />
                        ) : null}
                        {tarde.length > 0 ? (
                          <TimeGroup label="Tarde" slots={tarde} selected={slot} onSelect={setSlot} />
                        ) : null}
                        {noite.length > 0 ? (
                          <TimeGroup label="Noite" slots={noite} selected={slot} onSelect={setSlot} />
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <Vazio
                  titulo="Nenhum dia livre nas próximas três semanas"
                  detalhe={`Fale com ${organizationName} para consultar encaixes ou uma data mais distante.`}
                />
              )}
            </div>
          ) : null}

          {/* 4. Identificação */}
          {step === "identify" && slot ? (
            // A medida do formulário é limitada: campo de nome com 940px de
            // largura numa tela grande não é generosidade, é desorientação.
            <div className="mt-5 max-w-[440px] space-y-4">
              <Field label="Seu nome" htmlFor="nome">
                <Input
                  id="nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  enterKeyHint="next"
                  placeholder="Nome e sobrenome"
                  className={CAMPO}
                />
              </Field>

              <Field
                label="Celular com DDD"
                htmlFor="fone"
                hint="Serve para a recepção identificar você no dia."
              >
                <Input
                  id="fone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="done"
                  placeholder="(84) 99999-0000"
                  className={CAMPO}
                />
              </Field>

              {/* O e-mail é opcional e quase ninguém preenche: como campo aberto
                  ele só engorda o formulário no passo em que desistir é mais
                  fácil. Fica atrás de um pedido explícito. */}
              {mostrarEmail ? (
                <Field label="E-mail" htmlFor="email" optional>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    enterKeyHint="done"
                    placeholder="voce@email.com"
                    className={CAMPO}
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => setMostrarEmail(true)}
                  className="inline-flex min-h-11 items-center gap-1.5 text-label text-accent underline-offset-4 hover:underline"
                >
                  <Plus className="size-4" aria-hidden />
                  Adicionar e-mail
                </button>
              )}

              <label className="flex min-h-11 items-center gap-2.5 text-body text-ink-secondary">
                <input
                  type="checkbox"
                  checked={consentMarketing}
                  onChange={(e) => setConsentMarketing(e.target.checked)}
                  className="size-4 shrink-0 rounded-[3px] border-line-strong accent-accent"
                />
                Quero receber novidades de {organizationName}
              </label>

              {error ? (
                <p id="erro-agendamento" role="alert" className="text-caption text-danger">
                  {error}
                </p>
              ) : null}

              <div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={pending}
                  disabled={name.trim().length < 2 || phone.replace(/\D/g, "").length < 10}
                  aria-describedby={error ? "erro-agendamento" : undefined}
                  onClick={submit}
                >
                  Confirmar agendamento
                </Button>
                <p className="mt-3 text-caption text-ink-secondary">
                  Ao confirmar, você autoriza {organizationName} a usar seus dados para gerenciar este
                  atendimento.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* O "Continuar" do desktop.
            A barra fixa abaixo é `md:hidden`; sem este bloco, o desktop chegava
            a um beco — horário escolhido e nenhuma forma de seguir. */}
        {step === "when" && slot ? (
          <div className="mt-6 hidden items-center justify-between gap-4 border-t border-cartao-linha pt-5 md:flex">
            <span className="min-w-0 text-body text-ink-secondary">
              {maiuscula(format(new Date(slot.startsAt), "EEEE, d 'de' MMMM", { locale: ptBR }))} às{" "}
              <span className="text-card tabular text-ink">{slot.label}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => setStep("identify")}>
              Continuar
            </Button>
          </div>
        ) : null}
      </div>

      {/* Barra de ação do celular: só existe quando há uma escolha para levar
          adiante. Fundo SÓLIDO e não desfocado — desfoque sobre o grão do
          balcão vira lama, e este é o alvo que não pode perder contraste. */}
      {step === "when" && slot ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-cartao-fio bg-cartao px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-sticky md:hidden">
          <div className="mx-auto flex max-w-[620px] items-center justify-between gap-3">
            <span className="min-w-0 text-caption text-ink-secondary">
              {format(new Date(slot.startsAt), "EEE, d 'de' MMM", { locale: ptBR })} às{" "}
              <span className="text-label text-ink tabular">{slot.label}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => setStep("identify")}>
              Continuar
            </Button>
          </div>
        </div>
      ) : null}
    </Vitrine>
  );
}

/**
 * Moldura da página.
 *
 * O que saiu daqui: uma parede de gradiente roxo que ocupava 620 dos 844 pixels
 * da primeira tela do celular — 73% — para carregar um logotipo, duas linhas de
 * texto e três bolinhas numeradas. O conteúdo da clínica começava abaixo da
 * dobra.
 *
 * O que entrou: o nome da casa como manchete, na mesma serifa do logotipo, e o
 * roxo reduzido a um fio de 4px no topo. Quem abre este link quer ver o salão,
 * não o fornecedor do software — a assinatura da Agenda de Unha continua na
 * página, no rodapé, que é onde ela não custa a atenção de ninguém.
 */
function Vitrine({
  organizationName,
  unidade,
  laca,
  compacta,
  barraFixa,
  contato,
  children,
}: {
  organizationName: string;
  unidade: Branch | null;
  laca: Laca;
  /** Do passo "quando" em diante a fachada encolhe e devolve tela ao conteúdo. */
  compacta: boolean;
  /** A barra de ação do celular está no ar e precisa de chão reservado. */
  barraFixa: boolean;
  /**
   * Endereço e telefone no cabeçalho.
   *
   * Ficam de fora no bilhete: lá eles já estão escritos na linha "Onde", com o
   * link do mapa junto, e repeti-los no alto custava 92px de tela — 11% do
   * celular — para dizer duas vezes a mesma coisa.
   */
  contato?: boolean;
  children: React.ReactNode;
}) {
  const digitos = unidade?.phone?.replace(/\D/g, "") ?? "";
  const mostrarContato = contato !== false && Boolean(unidade?.address || digitos);
  return (
    <main
      data-surface="cartao"
      className="pilha-balcao grao relative isolate bg-balcao"
      style={
        {
          "--color-laca": laca.tinta,
          // O alvéolo: a luz que cai sobre o tampo bem onde o cartão está
          // apoiado. Sem ele o balcão é um bege chapado de parede.
          backgroundImage:
            "radial-gradient(70% 46% at 50% 0%, rgb(255 253 250 / 0.85) 0%, transparent 72%)," +
            "radial-gradient(88% 58% at 50% -6%, color-mix(in oklab, var(--color-laca) 9%, transparent) 0%, transparent 76%)",
        } as React.CSSProperties
      }
    >
      <div className="relative z-[1] flex w-full flex-1 flex-col items-center">
        {/*
          A página inteira é UM objeto pousado no balcão: a laca, o sorriso e o
          cartão são a mesma peça, com um recorte só. No celular ela vai de
          borda a borda — margem lateral ali é tela desperdiçada, e o aparelho
          já é a moldura. A partir de 768px ela descola do fundo e vira o que
          sempre foi: um cartão de mostruário deitado numa bancada.
        */}
        <article className="grao relative isolate flex w-full flex-1 flex-col overflow-hidden rounded-b-[24px] bg-cartao md:max-w-[760px] md:flex-none md:rounded-[24px] md:shadow-[inset_0_1px_0_rgb(255_255_255/.7),0_26px_60px_-24px_rgb(51_26_63/.28),0_2px_6px_rgb(51_26_63/.08)]">
          <header
            data-compacta={compacta || undefined}
            className="laca sorriso laca-entrada group relative isolate transition-[padding] duration-200 ease-[var(--ease-out-quint)]"
          >
            <div
              className={cn(
                "relative z-[1] px-5 pb-[calc(var(--sorriso)+10px)] group-data-[compacta]:pb-[calc(var(--sorriso)+4px)] md:px-10",
                // Sem endereço nem telefone o plano é só o nome: a mesma altura
                // de antes viraria uma faixa de cor com uma linha no meio.
                mostrarContato ? "pt-7 group-data-[compacta]:pt-5 md:pt-8" : "pt-6 md:pt-7",
              )}
            >
              {/*
                A compressão é `transform: scale()` com origem no canto, NUNCA
                transição de `font-size`: são dois refluxos por quadro e o
                traçado da Playfair fica instável no meio do caminho.
              */}
              <h1 className="origin-top-left font-brand text-fachada text-white transition-transform duration-200 ease-[var(--ease-out-quint)] group-data-[compacta]:scale-[0.74] md:group-data-[compacta]:scale-100">
                {organizationName}
              </h1>
              {mostrarContato ? (
                // `grid-template-rows: 1fr → 0fr` é a única forma de animar
                // altura desconhecida sem tirar o bloco do fluxo.
                // `invisible` junto do `opacity-0`: só a opacidade escondia dos
                // olhos e mantinha os dois links na ordem de tabulação — quem
                // navega por teclado parava num endereço que não está na tela.
                <div className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity,visibility] duration-200 ease-[var(--ease-out-quint)] group-data-[compacta]:invisible group-data-[compacta]:grid-rows-[0fr] group-data-[compacta]:opacity-0 md:group-data-[compacta]:visible md:group-data-[compacta]:grid-rows-[1fr] md:group-data-[compacta]:opacity-100">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5 overflow-hidden">
                    {unidade?.address ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(unidade.address)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 text-caption text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline"
                      >
                        <MapPin className="size-3.5 shrink-0 text-white/65" aria-hidden />
                        {unidade.address}
                      </a>
                    ) : null}
                    {digitos ? (
                      <a
                        href={`tel:+${digitos.length > 11 ? digitos : `55${digitos}`}`}
                        className="inline-flex min-h-11 items-center gap-1.5 text-caption text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline"
                      >
                        <Phone className="size-3.5 shrink-0 text-white/65" aria-hidden />
                        {unidade!.phone}
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <div className="relative z-[1] flex-1 px-5 pt-6 pb-8 md:px-10 md:pb-10">{children}</div>
        </article>

        <div aria-hidden className="sombra-contato hidden md:block" />

        {/*
          Respiro do balcão.
          No celular o cartão é que cresce (`flex-1` acima): passo curto deixava
          um toco de osso no alto e setecentos pixels de tampo embaixo, que é a
          mesma queixa que originou o redesenho, só que em bege. No desktop o
          cartão volta a ter a altura do conteúdo e é o tampo que emoldura.
        */}
        <div aria-hidden className="hidden md:block md:min-h-10" />

        <footer className="flex w-full items-center gap-2 px-5 pt-5 pb-2 md:max-w-[760px] md:px-0">
          <BrandLogo compact className="opacity-55 [&_img]:h-6" />
          <span className="text-meta text-ink-secondary">agendamento online</span>
        </footer>

        {/* O chão da barra de ação.
            Ela é `fixed` e come os últimos 73px da janela: sem esta folga, o
            rodapé fica embaixo dela — medido, 48px de sobreposição em
            390x844. Só existe quando a barra existe. */}
        {barraFixa ? <div aria-hidden className="h-[84px] shrink-0 md:hidden" /> : null}
      </div>
    </main>
  );
}

/**
 * O vazio, na superfície da própria página.
 *
 * Era um `Card` do produto: branco, com sombra, dentro de um cartão de osso —
 * objeto dentro de objeto, e a sombra dizendo "sou importante" para anunciar
 * que não há nada. Aqui o vazio é uma depressão no mesmo material.
 */
function Vazio({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="rounded-[14px] bg-cartao-sunken px-4 py-7 text-center">
      <p className="text-card text-ink">{titulo}</p>
      <p className="mx-auto mt-1 max-w-[36ch] text-body text-ink-secondary">{detalhe}</p>
    </div>
  );
}

/**
 * A espera, também no osso.
 *
 * O `Skeleton` do produto pulsa em lavanda; sobre o cartão de osso ele lia como
 * um retângulo azulado colado na página. Mesmo gesto, tinta certa.
 */
function Fantasma({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[10px] bg-cartao-sunken", className)}
    />
  );
}

/**
 * A unha postiça — o átomo que aposentou a gota de 12px.
 *
 * O arquivo `esmaltes.ts` já argumentava melhor do que a tela entregava: "o
 * ofício que ela está contratando é literalmente sobre cor". A gota gastava
 * esse argumento num círculo que ninguém via. A postiça é a mesma informação
 * na forma do próprio objeto — e continua sendo REFORÇO: o nome escrito da
 * categoria vem sempre ao lado, e quem não distingue os tons não perde nada.
 *
 * Três escalas e só três. O brilho é omitido abaixo de 22px de largura: um
 * reflexo de 3px não lê como vidro, lê como sujeira.
 */
function Postica({
  esmalte,
  className,
  brilho = true,
}: {
  esmalte: Esmalte;
  className?: string;
  brilho?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn("postica block", brilho && "postica-brilho", className)}
      style={{ "--esmalte": esmalte.fill, "--aro": esmalte.aro } as React.CSSProperties}
    />
  );
}

function LinhaRecibo({
  esmalte,
  principal,
  secundario,
  onTrocar,
}: {
  esmalte?: Esmalte;
  principal: string;
  secundario?: string;
  /**
   * Ausente significa "não há o que trocar", e o botão simplesmente não existe.
   *
   * Com um serviço publicado, o "Trocar" levava a uma tela de escolha com uma
   * opção só — e a linha de passo saía "0 de 2 · Serviço", contando um passo
   * que a própria clínica não tem. Reproduzido na conta ENTUR.
   */
  onTrocar?: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-cartao-sunken py-2.5 pl-3.5 pr-2">
      {esmalte ? <Postica esmalte={esmalte} className="animate-postica-in h-[30px] w-[22px]" /> : null}
      <div className="min-w-0 flex-1">
        {/*
          Duas linhas, e não `truncate`.
          Medido em 390px: "Quarta-feira, 26 de agosto às 09:30" precisa de
          278px e tinha 257 — o corte comia justamente o HORÁRIO, o único dado
          que a cliente abre esta tela para conferir.
        */}
        <p className="line-clamp-2 text-card text-ink">{principal}</p>
        {secundario ? <p className="truncate text-body text-ink-secondary">{secundario}</p> : null}
      </div>
      {onTrocar ? (
        <button
          type="button"
          onClick={onTrocar}
          className="min-h-11 shrink-0 rounded-control px-2.5 text-label font-semibold text-accent underline-offset-4 transition-colors hover:underline"
        >
          Trocar
          <span className="sr-only"> {principal}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * O bilhete.
 *
 * É o único lugar da página onde vale gastar movimento e volume: é o momento em
 * que a cliente terminou e vai querer olhar de novo — ou mostrar para alguém. A
 * data vem grande, na serifa da marca, porque é a única informação que ela
 * realmente precisa guardar.
 *
 * O relevo sai de `drop-shadow` no elemento de fora, e não de `box-shadow` no
 * papel: a máscara do picote recortaria a sombra junto e o papel perderia o
 * volume justamente na borda rasgada. `drop-shadow` segue o alfa e contorna
 * cada dente.
 */
function Bilhete({
  confirmation,
  esmalte,
  organizationName,
  service,
  slot,
}: {
  confirmation: BookingConfirmation;
  esmalte: Esmalte;
  organizationName: string;
  service: Service;
  slot: PublicSlot;
}) {
  const inicio = new Date(slot.startsAt);
  // `whenLabel` vem do servidor como "quinta-feira, 28 de agosto às 14:00", já
  // no fuso da clínica. O split é tolerante: se o formato mudar, a linha inteira
  // continua saindo como data e o bilhete não quebra.
  const [dataLabel, horaLabel] = confirmation.whenLabel.split(" às ");

  function adicionarAoCalendario() {
    const ics = montarICS(
      {
        titulo: `${service.name} — ${organizationName}`,
        inicio,
        duracaoMin: service.durationMin,
        local: [confirmation.branchName, confirmation.branchAddress].filter(Boolean).join(" — "),
        descricao: `Com ${confirmation.professionalName}.`,
      },
      `${slot.startsAt}-${slot.professionalId}@agendadeunha`,
    );
    baixarICS(ics, "agendamento.ics");
  }

  return (
    <div className="mx-auto max-w-[520px] animate-rise-in [filter:drop-shadow(0_26px_55px_rgb(67_35_88/0.20))]">
      <div className="picote rounded-t-overlay bg-surface-raised pb-6">
        <div className="px-6 pt-7 sm:px-8">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-positive-soft px-2.5 py-1 text-meta font-semibold uppercase tracking-[0.1em] text-positive">
            <Check className="size-3.5" aria-hidden />
            Confirmado
          </span>
          {/* Data e hora quebram em duas linhas COMANDADAS, não pelo acaso da
              largura: em 390px "quinta-feira, 28 de agosto às 14:00" deixava o
              "14:00" órfão numa segunda linha — justamente o dado que ela
              abriu a tela para conferir. Duas linhas na serifa da marca leem
              como convite; uma linha estourada lê como erro. */}
          <p className="mt-5 font-brand text-house text-ink">{maiuscula(dataLabel)}</p>
          {horaLabel ? <p className="font-brand text-house text-ink tabular">às {horaLabel}</p> : null}
          <p className="mt-2 text-body text-ink-secondary">
            {organizationName} está te esperando.
          </p>
        </div>

        {/* O picote horizontal: a linha por onde o bilhete se destacaria. */}
        <div className="mt-6 flex items-center gap-3 px-6 sm:px-8">
          <Postica esmalte={esmalte} className="h-[19px] w-[14px]" brilho={false} />
          <span className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-cartao-linha)_0_6px,transparent_6px_12px)]" />
        </div>

        <dl className="mt-5 space-y-3.5 px-6 sm:px-8">
          <LinhaBilhete rotulo="Serviço" valor={confirmation.serviceName} />
          <LinhaBilhete rotulo="Com" valor={confirmation.professionalName} />
          <LinhaBilhete
            rotulo="Onde"
            valor={confirmation.branchName}
            complemento={confirmation.branchAddress ?? undefined}
          />
          <LinhaBilhete rotulo="Valor" valor={precoPartido(service.priceCents).join(" ")} />
        </dl>

        <div className="mt-6 grid gap-2 px-6 sm:px-8">
          <Button variant="secondary" size="lg" className="w-full" onClick={adicionarAoCalendario}>
            <CalendarPlus className="size-4" aria-hidden />
            Adicionar ao calendário
          </Button>
          {confirmation.branchAddress ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(confirmation.branchAddress)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 text-label text-accent underline-offset-4 hover:underline"
            >
              <MapPin className="size-4" aria-hidden />
              Como chegar
            </a>
          ) : null}
        </div>

        <p className="mt-5 px-6 text-caption text-ink-secondary sm:px-8">
          Para remarcar ou cancelar, fale diretamente com a recepção.
        </p>
      </div>
    </div>
  );
}

function LinhaBilhete({
  rotulo,
  valor,
  complemento,
}: {
  rotulo: string;
  valor: string;
  complemento?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-caption text-ink-secondary">{rotulo}</dt>
      <dd className="min-w-0 text-right">
        <span className="block text-label text-ink">{valor}</span>
        {complemento ? (
          <span className="mt-0.5 block text-caption text-ink-secondary">{complemento}</span>
        ) : null}
      </dd>
    </div>
  );
}

function TimeGroup({
  label,
  slots,
  selected,
  onSelect,
}: {
  label: string;
  slots: PublicSlot[];
  selected: PublicSlot | null;
  onSelect: (slot: PublicSlot) => void;
}) {
  return (
    <section>
      {/* O rótulo estica até a margem com uma guia pontilhada, como o cabeçalho
          de seção de um cardápio: sem ela a palavra fica solta à esquerda e a
          grade abaixo parece começar sozinha. */}
      <h3 className="mb-2.5 flex items-center">
        <span className="shrink-0 text-eyebrow text-ink-secondary">{label}</span>
        <span aria-hidden className="guia" />
      </h3>
      {/*
        Chips soltos, e não uma grade emoldurada.
        A grade de fio único ficou mais bonita e MENTIU: a última fila quase
        nunca fecha, e as três células vazias que sobravam depois do último
        horário liam como vagas que não cabiam na tela. Numa página cujo
        trabalho inteiro é dizer o que está livre, isso é o pior defeito
        possível.
      */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {slots.map((item) => {
          const active = selected?.startsAt === item.startsAt;
          return (
            <button
              key={item.startsAt}
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={active}
              className={cn(
                // 52px de alvo: é um dedo, à noite, deitada, numa grade
                // encostada em outra grade.
                // 52px de alvo: é um dedo, à noite, deitada, numa grade
                // encostada em outra grade.
                "h-[52px] rounded-[10px] text-body tabular transition-colors duration-[120ms]",
                active
                  ? "bg-accent font-bold text-white"
                  : "bg-cartao text-ink ring-1 ring-cartao-fio hover:bg-cartao-sunken",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Os passos que ESTA clínica realmente tem.
 *
 * A trilha antiga dizia "3" sempre, e mentia nas duas pontas: com um serviço
 * publicado são 2 passos, com mais de uma unidade são 4. Vive fora do
 * componente para poder ser provada sem navegador — contador de passo que mente
 * é o tipo de defeito que ninguém nota até a cliente perguntar quantas telas
 * ainda faltam.
 */
export function passosDaClinica(quantosServicos: number, quantasUnidades: number): string[] {
  return [
    ...(quantosServicos > 1 ? ["Serviço"] : []),
    ...(quantasUnidades > 1 ? ["Unidade"] : []),
    "Dia e hora",
    "Seus dados",
  ];
}

/**
 * "2h30" no lugar de "150 min".
 *
 * Ninguém marca a tarde pensando em cento e cinquenta minutos. Acima de uma
 * hora a cliente precisa saber quanto do dia dela aquilo ocupa, e é em horas
 * que ela pensa isso.
 */
export function duracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function groupByCategory(services: Service[]): Array<[string | null, Service[]]> {
  const map = new Map<string | null, Service[]>();
  for (const service of services) {
    const key = service.categoryName;
    const list = map.get(key) ?? [];
    list.push(service);
    map.set(key, list);
  }
  return [...map.entries()];
}
