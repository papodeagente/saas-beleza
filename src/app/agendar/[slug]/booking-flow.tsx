"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Phone,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { precoPartido } from "@/lib/money";
import { dateISOInTz, formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand";
import { type Esmalte, type Laca, esmalteDe, lacaDe } from "./esmaltes";
import {
  type Celula,
  diasConsultaveis,
  gradeDoMes,
  limitesDeNavegacao,
  mesAAbrir,
  mesDe,
  somarDias,
  somarMeses,
} from "./calendario";
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
  /** Até quantos dias à frente este serviço aceita marcação. */
  maxLeadDays: number;
};

type Branch = { id: number; name: string; address: string | null; phone: string | null };

/**
 * "dia" e "hora" são uma tela só: no celular a escolha do dia custava 900px de
 * rolagem e mais um toque para depois descobrir que aquele dia não tinha o
 * horário que servia.
 *
 * O dia se escolhe num MÊS, não numa faixa que rola para o lado. A faixa
 * mostrava 21 dias enquanto os serviços desta base aceitam marcação de 45 a 120
 * dias à frente — até quatro meses de agenda que a cliente não tinha como
 * alcançar, e cuja existência a tela não denunciava. Uma grade de mês também
 * responde de graça a pergunta que a faixa não respondia: em que semana esta
 * clínica costuma ter espaço.
 */
type Step = "service" | "when" | "identify" | "done";

/**
 * A ordem em que os passos acontecem. Serve para saber, na troca, se a cliente
 * avançou ou voltou — e é isso que decide de que lado a tela nova entra.
 */
const ORDEM_DOS_PASSOS: Step[] = ["service", "when", "identify", "done"];

/**
 * Cabeçalho da grade. Uma letra só, porque a coluna tem a largura de um dedo.
 * A ambiguidade de "S" e "Q" repetidos é convenção de calendário em português e
 * some na leitura da grade inteira; quem ouve a página nunca passa por aqui,
 * porque cada dia livre se anuncia com a data por extenso.
 */
const INICIAIS_DA_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

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
  fuso,
  branches,
  services,
}: {
  slug: string;
  organizationName: string;
  /** Fuso do salão. Toda hora e todo dia desta tela são lidos nele. */
  fuso: string;
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
  /**
   * A unidade nasce escolhida — a primeira da lista — em vez de ser um passo.
   *
   * Uma tela inteira só para dizer "Ponta Negra" custava um toque e um passo a
   * mais no contador, e a pergunta que ela fazia não é a que a cliente tem na
   * cabeça: ela quer saber QUANDO, e a unidade é um detalhe da resposta. Agora
   * a troca mora ao lado do calendário, onde é o que de fato é — um filtro do
   * que está livre.
   */
  const [branch, setBranch] = useState<Branch | null>(branches[0] ?? null);
  const [step, setStep] = useState<Step>(servicoUnico ? "when" : "service");
  /**
   * De que lado a próxima tela entra: 1 avança, -1 volta. Mora em estado, e não
   * num efeito, porque quem sabe o sentido é o clique — o efeito só descobriria
   * depois, com um quadro já pintado no sentido errado.
   */
  const [sentido, setSentido] = useState(1);

  function irPara(proximo: Step) {
    setSentido(ORDEM_DOS_PASSOS.indexOf(proximo) >= ORDEM_DOS_PASSOS.indexOf(step) ? 1 : -1);
    setStep(proximo);
  }
  /**
   * Hoje, no fuso de quem está olhando, fixado na montagem. Recalcular a cada
   * render faria a grade trocar de dia sozinha na virada da meia-noite, no meio
   * de um preenchimento.
   */
  const hojeISO = useMemo(() => dateISOInTz(new Date(), fuso), [fuso]);
  /** Nenhum dia escolhido é um estado real: mês sem vaga nenhuma. */
  const [day, setDay] = useState<string | null>(null);
  const [mes, setMes] = useState(() => mesDe(hojeISO));
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  /**
   * Dias livres POR MÊS, guardados desde a primeira visita.
   *
   * Voltar um mês é o gesto mais comum do calendário — a cliente espia adiante
   * e desiste — e sem esta memória cada volta custaria a viagem inteira ao
   * servidor de novo, com a grade piscando em esqueleto.
   */
  const [diasPorMes, setDiasPorMes] = useState<
    Record<string, Array<{ dateISO: string; slotCount: number }>>
  >({});
  /**
   * O mês visível, em espelho síncrono.
   *
   * A grade de mês trouxe uma corrida que a faixa não tinha: duas setas em
   * sequência disparam duas buscas, e a primeira pode responder por último. Sem
   * guarda, ela escolheria um dia de agosto embaixo da grade de outubro — dois
   * meses diferentes na mesma tela, e a cliente marcaria o dia errado. O estado
   * do React não serve de guarda porque só chega no render seguinte; o espelho
   * é escrito no mesmo instante do clique.
   */
  const mesVisivelRef = useRef(mesDe(hojeISO));
  function mostrarMes(alvo: string) {
    mesVisivelRef.current = alvo;
    setMes(alvo);
  }
  /** A busca para a frente já varreu tudo e não achou nada. */
  const [semVagaAteOFim, setSemVagaAteOFim] = useState(false);
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

  /**
   * Trocar de serviço ou de unidade invalida TODOS os meses guardados: a
   * disponibilidade é do par serviço × unidade, não da clínica. Reaproveitar a
   * memória aqui pintaria agosto com os dias livres do serviço anterior.
   */
  function loadDays(next: { service: Service | null; branch: Branch | null }) {
    setDiasPorMes({});
    setSemVagaAteOFim(false);
    setDay(null);
    setSlot(null);
    setSlots(null);
    mostrarMes(mesDe(hojeISO));
    buscarDias(next, mesDe(hojeISO), { podeAvancar: true });
  }

  /**
   * Busca um mês e escolhe o primeiro dia livre dele.
   *
   * `podeAvancar` existe para a virada do mês: quem abre a página no dia 30 cai
   * num mês que tem um ou nenhum dia livre, e a grade de agosto vazia diz
   * "lotado" quando setembro está inteiro em aberto. Avança UMA vez, no
   * carregamento inicial — dois saltos automáticos já seriam a página decidindo
   * sozinha para onde a cliente estava olhando.
   */
  function buscarDias(
    next: { service: Service | null; branch: Branch | null },
    mesAlvo: string,
    opcoes?: { podeAvancar?: boolean },
  ) {
    const servico = next.service;
    if (!servico) return;
    const { ultimoISO, ultimoMes } = limitesDeNavegacao(
      hojeISO,
      servico.maxLeadDays,
    );
    const alvos = diasConsultaveis(mesAlvo, hojeISO, ultimoISO);
    if (alvos.length === 0) {
      setDiasPorMes((atual) => ({ ...atual, [mesAlvo]: [] }));
      return;
    }
    startDaysTransition(async () => {
      const rows = await publicAvailableDaysAction({
        slug,
        serviceId: servico.id,
        branchId: next.branch?.id,
        dateISOs: alvos,
      });
      setDiasPorMes((atual) => ({ ...atual, [mesAlvo]: rows }));
      // O que voltou vale sempre: guardar o mês no cache é correto mesmo que a
      // cliente já esteja olhando outro. O que NÃO vale é mexer no dia
      // escolhido a partir de uma resposta atrasada.
      if (mesVisivelRef.current !== mesAlvo) return;
      const abrir = mesAAbrir(
        mesAlvo,
        rows.length,
        opcoes?.podeAvancar ?? false,
        ultimoMes,
      );
      if (abrir !== mesAlvo) {
        mostrarMes(abrir);
        buscarDias(next, abrir);
        return;
      }
      const primeiro = rows[0];
      if (primeiro) {
        setDay(primeiro.dateISO);
        loadSlots({ ...next, day: primeiro.dateISO });
      }
    });
  }

  /**
   * Procura para a frente o primeiro mês com horário.
   *
   * Sem isto, um serviço cadastrado numa unidade onde ninguém o executa vira
   * beco sem saída: a cliente vê uma grade cinzenta e teria que clicar na seta
   * uma vez por mês para descobrir que não há nada — e a maioria fecha a página
   * antes. A busca é o mesmo trabalho, feito de uma vez e por conta da página.
   *
   * Custa uma consulta por mês vazio, no máximo quatro (`maxLeadDays` chega a
   * 120 dias nesta base). É gesto pedido pela cliente, nunca automático.
   */
  function procurarProximoMesComVaga() {
    const servico = service;
    if (!servico) return;
    const { ultimoISO, ultimoMes } = limitesDeNavegacao(
      hojeISO,
      servico.maxLeadDays,
    );
    const origem = mes;
    startDaysTransition(async () => {
      let alvo = origem;
      while (alvo < ultimoMes) {
        // Ela clicou numa seta enquanto a busca corria: a busca desiste. Levá-la
        // ao mês que a busca achou seria arrancar da tela o mês que ela acabou
        // de pedir.
        if (mesVisivelRef.current !== origem) return;
        alvo = somarMeses(alvo, 1);
        const dias = diasConsultaveis(alvo, hojeISO, ultimoISO);
        const rows = dias.length
          ? await publicAvailableDaysAction({
              slug,
              serviceId: servico.id,
              branchId: branch?.id,
              dateISOs: dias,
            })
          : [];
        setDiasPorMes((atual) => ({ ...atual, [alvo]: rows }));
        if (rows.length > 0) {
          if (mesVisivelRef.current !== origem) return;
          mostrarMes(alvo);
          setFoco(null);
          setDay(rows[0].dateISO);
          loadSlots({ service, branch, day: rows[0].dateISO });
          return;
        }
      }
      // Fica no mês em que ela estava: levá-la para dezembro só para mostrar
      // outra grade cinzenta trocaria uma tela vazia por outra.
      setSemVagaAteOFim(true);
    });
  }

  /**
   * Trocar o mês visível. Mês já visitado não volta ao servidor.
   *
   * O dia escolhido sobrevive à ida e volta: quem espia setembro e retorna a
   * agosto encontra o mesmo dia marcado e os mesmos horários embaixo. Só quando
   * o dia atual não pertence ao mês aberto é que o primeiro livre assume.
   */
  function abrirMes(mesAlvo: string) {
    mostrarMes(mesAlvo);
    setFoco(null);
    const guardado = diasPorMes[mesAlvo];
    if (!guardado) {
      buscarDias({ service, branch }, mesAlvo);
      return;
    }
    if (
      day &&
      mesDe(day) === mesAlvo &&
      guardado.some((d) => d.dateISO === day)
    )
      return;
    const primeiro = guardado[0];
    setDay(primeiro?.dateISO ?? null);
    setSlot(null);
    if (primeiro) loadSlots({ service, branch, day: primeiro.dateISO });
    else setSlots([]);
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
  /**
   * Tabulação rotativa da grade: um único dia entra na ordem de tabulação, e as
   * setas movem o foco entre eles. Sem isso, alcançar o painel de horários pelo
   * teclado custaria vinte e dois Tab — um por dia livre do mês.
   */
  const gradeRef = useRef<HTMLDivElement>(null);
  const [foco, setFoco] = useState<string | null>(null);
  useEffect(() => {
    if (!foco) return;
    gradeRef.current
      ?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)
      ?.focus();
  }, [foco]);

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
    if (servicoUnico)
      buscarDias({ service: servicoUnico, branch }, mesDe(hojeISO), {
        podeAvancar: true,
      });
    // Uma vez na montagem: as dependências reais são as props iniciais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Carregar horários é sempre consequência de uma escolha do cliente
   * (serviço, unidade ou data), então roda numa transição — o indicador de
   * carregamento vem do React, sem efeito nem render em cascata.
   */
  /**
   * O último dia pedido, em espelho síncrono. Mesma corrida das setas: numa
   * grade de mês inteiro é fácil tocar dois dias em sequência, e a resposta do
   * primeiro chegando por último pintaria os horários do dia errado embaixo do
   * dia marcado.
   */
  const diaPedidoRef = useRef<string | null>(null);

  function loadSlots(next: {
    service: Service | null;
    branch: Branch | null;
    day: string;
  }) {
    setSlot(null);
    diaPedidoRef.current = next.day;
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
      if (diaPedidoRef.current !== next.day) return;
      setSlots(rows);
    });
  }

  function chooseService(value: Service) {
    setService(value);
    irPara("when");
    loadDays({ service: value, branch });
  }

  /**
   * Trocar de unidade no meio do calendário.
   *
   * A disponibilidade é do par serviço × unidade, então tudo o que estava na
   * tela — mês, dia e horário — deixa de valer no instante da troca. É o mesmo
   * `loadDays` que a escolha de serviço usa.
   */
  function trocarUnidade(value: Branch) {
    if (value.id === branch?.id) return;
    setBranch(value);
    loadDays({ service, branch: value });
  }

  const horariosRef = useRef<HTMLHeadingElement>(null);

  /**
   * A coluna de horários rola por dentro no desktop, e o último chip fica
   * cortado ao meio pela borda inferior. Cortado e mais nada lê como defeito de
   * renderização; cortado sob um esmaecimento lê como "continua". O
   * esmaecimento só aparece quando há mesmo o que rolar — pintado sempre, ele
   * apagaria de graça o último horário de um dia curto.
   */
  const rolagemRef = useRef<HTMLDivElement>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);
  const [temMaisHorarios, setTemMaisHorarios] = useState(false);
  useEffect(() => {
    const moldura = rolagemRef.current;
    const conteudo = conteudoRef.current;
    if (!moldura || !conteudo) {
      setTemMaisHorarios(false);
      return;
    }
    const medir = () =>
      setTemMaisHorarios(
        moldura.scrollHeight - moldura.scrollTop - moldura.clientHeight > 8,
      );
    medir();
    /**
     * Observar a MOLDURA não bastava: ela tem altura fixa e nunca muda de
     * tamanho, então a única medida que valia era a do primeiro instante — e
     * naquele instante o conteúdo ainda não tinha assentado. Medido, o
     * esquecimento aparecia como 330 contra 330 numa coluna que segundos depois
     * media 420. Quem cresce é o CONTEÚDO, e é ele que precisa avisar.
     */
    const observador = new ResizeObserver(medir);
    observador.observe(moldura);
    observador.observe(conteudo);
    moldura.addEventListener("scroll", medir, { passive: true });
    return () => {
      observador.disconnect();
      moldura.removeEventListener("scroll", medir);
    };
  }, [step, day, slots, loadingSlots]);

  function chooseDay(value: string) {
    setDay(value);
    setFoco(value);
    loadSlots({ service, branch, day: value });
    /**
     * No celular a grade do mês ocupa a tela inteira e os horários nascem
     * abaixo da dobra: sem este salto, escolher um dia parece não fazer nada.
     * No desktop os dois estão lado a lado e mover a página seria gratuito.
     *
     * Só no toque da cliente. Fazer isso na escolha automática da montagem
     * rolaria a página de quem acabou de chegar, passando por cima do nome da
     * clínica e do serviço que ela precisa conferir.
     */
    if (window.matchMedia("(min-width: 768px)").matches) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    horariosRef.current?.scrollIntoView({
      behavior: suave ? "smooth" : "auto",
      block: "start",
    });
  }

  /**
   * Setas do teclado dentro da grade, como em qualquer calendário.
   *
   * Só os dias LIVRES entram na navegação, que é o mesmo conjunto que o mouse
   * alcança: parar o foco num dia lotado seria oferecer um alvo que não
   * responde. Cima e baixo andam uma semana e caem no dia livre mais próximo
   * naquele sentido, não no sétimo item da lista — em fevereiro de 2027 o dia
   * 8 fica exatamente embaixo do 1º, e é isso que o dedo espera.
   */
  function navegarGrade(evento: React.KeyboardEvent<HTMLDivElement>) {
    const atualISO = (evento.target as HTMLElement).dataset?.dia;
    if (!atualISO) return;
    const livres = (diasPorMes[mes] ?? []).map((d) => d.dateISO);
    const i = livres.indexOf(atualISO);
    if (i < 0) return;
    const semana = (sentido: 1 | -1) => {
      const alvo = somarDias(atualISO, 7 * sentido);
      const candidatos =
        sentido === 1 ? livres.slice(i + 1) : livres.slice(0, i).reverse();
      return (
        candidatos.find((d) => (sentido === 1 ? d >= alvo : d <= alvo)) ??
        candidatos.at(-1)
      );
    };
    const destino = {
      ArrowRight: livres[i + 1],
      ArrowLeft: livres[i - 1],
      ArrowDown: semana(1),
      ArrowUp: semana(-1),
      Home: livres[0],
      End: livres.at(-1),
    }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    setFoco(destino);
  }

  function submit() {
    if (!service || !slot || !day) return;
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
        irPara("done");
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
          irPara("when");
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
  const dayDate = day ? parseISO(day) : null;
  /**
   * A barrinha de lotação de cada dia saiu junto com a faixa.
   *
   * Numa fita de catorze cartões ela informava; repetida em 31 células de uma
   * grade vira textura, e textura que finge ser dado é pior do que nada. A
   * pergunta que ela respondia — "este dia está cheio?" — passou a ser
   * respondida pelo painel ao lado, que diz o número de horários do dia
   * escolhido. E a pergunta que a fita NÃO respondia, "quando esta clínica tem
   * espaço", agora é a forma do mês inteiro.
   */
  const diasDoMes = diasPorMes[mes] ?? null;
  const livresDoMes = useMemo(
    () => new Map((diasDoMes ?? []).map((d) => [d.dateISO, d.slotCount])),
    [diasDoMes],
  );
  const limites = limitesDeNavegacao(hojeISO, service?.maxLeadDays ?? 60);
  const grade = useMemo<Celula[]>(() => gradeDoMes(mes), [mes]);
  /**
   * Esqueleto só quando o mês NUNCA foi buscado. Mês guardado troca na hora, e
   * piscar esqueleto por cima de dado que já se tem é fingir trabalho.
   */
  const carregandoMes = loadingDays && diasDoMes === null;
  /** O único dia da grade que entra na ordem de tabulação. */
  const paradaDeTab = foco ?? day ?? diasDoMes?.[0]?.dateISO ?? null;
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
  const passos = passosDaClinica(services.length);
  const rotuloDoPasso =
    step === "service" ? "Serviço" : step === "when" ? "Dia e hora" : "Seus dados";
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
      <div className="min-w-0">
        {/*
          A trilha fica FORA da árvore que remonta a cada passo.

          Dentro dela, cada traço nasceria já preenchido e não haveria travessia
          nenhuma para ver — animação que só existe no código. Aqui ela
          sobrevive à troca, e é o traço que cresce da esquerda para a direita
          que conta à cliente que ela andou.

          A contagem só sai quando o passo aberto ESTÁ na lista: clínica sem
          serviço publicado abre em "service", que não é passo quando não há
          escolha, e a trilha diria "0 de 2" acima de "nada disponível".
        */}
        {posicaoDoPasso > 0 ? <Trilha passos={passos} atual={posicaoDoPasso - 1} /> : null}
        {/* A trilha desenhada é para os olhos; esta linha é para quem ouve. */}
        <p role="status" aria-live="polite" className="sr-only">
          {posicaoDoPasso > 0 ? `Passo ${posicaoDoPasso} de ${passos.length}: ` : ""}
          {rotuloDoPasso}
        </p>
        <div
          key={step}
          style={{ "--dir": sentido } as React.CSSProperties}
          className="passo-entrada min-w-0"
        >
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
              onTrocar={services.length > 1 ? () => irPara("service") : undefined}
            />
          ) : null}
          {branch && branches.length > 1 && step === "identify" ? (
            <LinhaRecibo
              principal={branch.name}
              secundario={branch.address ?? undefined}
              onTrocar={() => irPara("when")}
            />
          ) : null}
          {slot && step === "identify" ? (
            <LinhaRecibo
              principal={`${maiuscula(formatTz(new Date(slot.startsAt), fuso, "EEEE, d 'de' MMMM"))} às ${slot.label}`}
              secundario={`com ${slot.professionalName}`}
              onTrocar={() => irPara("when")}
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
              : step === "when"
                ? "Quando fica bom para você?"
                : "Só falta você se identificar"}
          </h2>

          {/* 1. Serviço — uma carta de preços, que é como salão mostra serviço. */}
          {step === "service" ? (
            <div className="mt-5 space-y-6">
              {groupByCategory(services).map(([category, list], indiceDaSecao) => {
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
                      {list.map((item, indiceNaSecao) => {
                        const [simbolo, numero] = precoPartido(item.priceCents);
                        /*
                          A cascata entra na ordem em que se lê, e para aos
                          260ms: passado esse ponto, o escalonamento deixa de
                          soar como "a carta está se abrindo" e passa a soar
                          como "a página está lenta". Catálogo de trinta itens
                          não pode custar dois segundos de espera coreografada.
                        */
                        const atraso = Math.min(indiceDaSecao * 70 + indiceNaSecao * 34, 260);
                        return (
                          <li
                            key={item.id}
                            className="entrada-escalonada"
                            style={{ "--atraso": `${atraso}ms` } as React.CSSProperties}
                          >
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

          {/* 2. Dia e hora, na mesma tela. */}
          {step === "when" ? (
            <>
              {/*
                A unidade virou o primeiro gesto DESTA tela, no lugar de uma
                tela só dela.

                Em pílula, e não em placa: placa é para o que se escolhe uma vez
                (o serviço); pílula é para o que se alterna enquanto se procura,
                que é o que a cliente faz com duas unidades da mesma casa. O
                endereço da que estiver ativa continua à vista, no alto do
                cartão — trocar aqui troca a fachada lá em cima.
              */}
              {branches.length > 1 ? (
                <nav
                  aria-label="Unidade"
                  className="-mx-1 mt-5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {branches.map((item, i) => {
                    const ativa = item.id === branch?.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => trocarUnidade(item)}
                        aria-pressed={ativa}
                        style={{ "--atraso": `${i * 40}ms` } as React.CSSProperties}
                        className={cn(
                          "entrada-escalonada min-h-11 shrink-0 rounded-pill px-4 text-body transition-[background-color,color,box-shadow] duration-[160ms]",
                          ativa
                            ? "bg-accent font-semibold text-white"
                            : "bg-cartao text-ink ring-1 ring-cartao-fio hover:bg-cartao-sunken",
                        )}
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </nav>
              ) : null}

              <div className="mt-5 md:grid md:grid-cols-[minmax(0,1fr)_252px] md:gap-6">
              {/* ————— o mês ————— */}
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-section first-letter:uppercase">
                    {format(parseISO(`${mes}-01`), "MMMM 'de' yyyy", {
                      locale: ptBR,
                    })}
                  </p>
                  <div className="flex gap-1">
                    <SetaDeMes
                      sentido={-1}
                      rotulo="Mês anterior"
                      desabilitada={mes <= limites.primeiroMes}
                      onClick={() => abrirMes(somarMeses(mes, -1))}
                    />
                    <SetaDeMes
                      sentido={1}
                      rotulo="Próximo mês"
                      desabilitada={mes >= limites.ultimoMes}
                      onClick={() => abrirMes(somarMeses(mes, 1))}
                    />
                  </div>
                </div>

                {/*
                  A grade sangra 8px para cada lado no celular e aperta o vão
                  para 2px. É aritmética, não gosto: sete colunas de 44px pedem
                  308px, e uma tela de 320px tem 280px úteis dentro do cartão.
                  Sangrando e apertando, a célula vai a 40×48 — 1920px² contra
                  os 1936px² de um alvo de 44×44, a mesma área, mais alta do que
                  larga. Acima de 390px sobra folga e nada disso se nota.
                */}
                <div
                  aria-hidden
                  className="-mx-2 mt-4 grid grid-cols-7 gap-0.5 sm:mx-0 sm:gap-1"
                >
                  {INICIAIS_DA_SEMANA.map((letra, i) => (
                    <span
                      key={i}
                      className="text-center text-meta text-ink-secondary"
                    >
                      {letra}
                    </span>
                  ))}
                </div>

                {/*
                  `key={mes}` remonta a grade a cada virada, e é o que faz a
                  varredura de entrada tocar de novo: sem isso o React
                  reaproveitaria as 42 células e a troca de mês aconteceria sem
                  nenhum sinal de que algo mudou.
                */}
                <div
                  key={mes}
                  ref={gradeRef}
                  role="group"
                  aria-label={`Dias com horário livre em ${format(parseISO(`${mes}-01`), "MMMM 'de' yyyy", { locale: ptBR })}`}
                  onKeyDown={navegarGrade}
                  className="-mx-2 mt-1.5 grid grid-cols-7 gap-0.5 sm:mx-0 sm:gap-1"
                >
                  {grade.map((dia, i) => {
                    // Célula de mês vizinho: existe para segurar a coluna, e
                    // não se mostra. Pintar o dia 31 de agosto dentro de
                    // setembro, apagado e sem resposta ao toque, é oferecer uma
                    // data que a grade ao lado já oferece de verdade.
                    if (dia === null)
                      return (
                        <span key={`fora-${i}`} aria-hidden className="h-12" />
                      );

                    const atraso = {
                      "--atraso": `${Math.min(i, 42) * 5}ms`,
                    } as React.CSSProperties;
                    // O esqueleto não recebe o atraso: ele já pulsa, e uma
                    // varredura por cima da pulsação são dois movimentos
                    // disputando a mesma célula.
                    if (carregandoMes)
                      return (
                        <Fantasma key={dia} className="h-12 rounded-[12px]" />
                      );

                    const vagas = livresDoMes.get(dia);
                    const numero = Number(dia.slice(8));
                    const hoje = dia === hojeISO;

                    if (vagas === undefined)
                      return (
                        <span
                          key={dia}
                          aria-hidden
                          style={atraso}
                          className={cn(
                            "dia-entrada flex h-12 items-center justify-center text-body text-ink-muted",
                            hoje && "font-semibold",
                          )}
                        >
                          {numero}
                        </span>
                      );

                    const ativo = dia === day;
                    return (
                      <button
                        key={dia}
                        data-dia={dia}
                        type="button"
                        tabIndex={dia === paradaDeTab ? 0 : -1}
                        onClick={() => chooseDay(dia)}
                        aria-pressed={ativo}
                        aria-label={`${format(parseISO(dia), "EEEE, d 'de' MMMM", { locale: ptBR })} — ${vagas} ${vagas === 1 ? "horário livre" : "horários livres"}`}
                        style={atraso}
                        className={cn(
                          "dia-entrada relative flex h-12 items-center justify-center rounded-[12px] text-body tabular transition-colors",
                          ativo
                            ? "bg-accent font-semibold text-white"
                            : "bg-cartao-sunken text-ink ring-1 ring-cartao-fio hover:bg-cartao-linha",
                        )}
                      >
                        {numero}
                        {/* Hoje leva um ponto, e só quando não está escolhido:
                            sobre a ameixa o ponto vira sujeira, e o dia
                            escolhido já se anuncia inteiro. */}
                        {hoje && !ativo ? (
                          <span
                            aria-hidden
                            className="absolute bottom-1.5 size-1 rounded-pill bg-accent"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {!carregandoMes && diasDoMes?.length === 0 ? (
                  <div className="mt-3">
                    <p className="text-body text-ink-secondary">
                      Nenhum horário livre em{" "}
                      {format(parseISO(`${mes}-01`), "MMMM", { locale: ptBR })}.
                    </p>
                    {semVagaAteOFim || mes >= limites.ultimoMes ? (
                      <p className="mt-1 text-body text-ink-secondary">
                        Não há horário livre até{" "}
                        {format(parseISO(`${limites.ultimoMes}-01`), "MMMM", {
                          locale: ptBR,
                        })}
                        . Fale com {organizationName} para consultar encaixes.
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={procurarProximoMesComVaga}
                        disabled={loadingDays}
                        className="mt-1 inline-flex min-h-11 items-center text-label font-semibold text-accent underline-offset-4 hover:underline disabled:opacity-60"
                      >
                        {loadingDays
                          ? "Procurando…"
                          : "Procurar o próximo mês com horário"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              {/*
                ————— os horários do dia —————

                No desktop esta coluna é uma CAMADA POSTA POR CIMA da própria
                célula da grade (`absolute inset-0`), e não conteúdo dentro
                dela. A diferença é a altura: como item de grade, uma lista de
                quarenta horários esticava a linha, e o cartão — que recorta o
                próprio conteúdo por causa da linha do sorriso — cortava os
                últimos horários ao meio, sem barra de rolagem nenhuma. Fora do
                fluxo, a altura da linha passa a ser a da grade do mês, e a
                lista rola por dentro.
              */}
              <div className="mt-7 md:relative md:mt-0 md:border-l md:border-cartao-linha">
                <div className="md:absolute md:inset-0 md:flex md:flex-col md:overflow-hidden md:pl-6">
                  <p role="status" aria-live="polite" className="sr-only">
                    {carregandoMes
                      ? "Carregando dias"
                      : !dayDate
                        ? "Nenhum dia livre neste mês"
                        : loadingSlots
                          ? "Carregando horários"
                          : `${format(dayDate, "EEEE, d 'de' MMMM", { locale: ptBR })}: ${times.length} ${times.length === 1 ? "horário livre" : "horários livres"}`}
                  </p>

                  {dayDate ? (
                    <>
                      <h3
                        ref={horariosRef}
                        className="scroll-mt-4 text-card text-ink first-letter:uppercase"
                      >
                        {format(dayDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
                      </h3>
                      <p
                        aria-hidden
                        className="mt-0.5 text-body text-ink-secondary"
                      >
                        {loadingSlots
                          ? "Buscando horários"
                          : times.length === 1
                            ? "1 horário livre"
                            : `${times.length} horários livres`}
                      </p>
                      {/*
                      A coluna acompanha a altura da grade e rola por dentro: um
                      dia com quarenta horários empurraria o rodapé do cartão
                      para baixo do calendário, e a cliente perderia de vista a
                      grade que acabou de usar. No celular não há coluna — a
                      lista simplesmente segue embaixo.
                    */}
                      <div
                        ref={rolagemRef}
                        className={cn(
                          "mt-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain md:pr-1 md:pb-1",
                          temMaisHorarios &&
                            "md:[mask-image:linear-gradient(to_bottom,#000_0,#000_calc(100%-40px),transparent_100%)]",
                        )}
                      >
                        <div ref={conteudoRef} className="space-y-5">
                          {loadingSlots ? (
                            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-3">
                              {Array.from({ length: 9 }).map((_, i) => (
                                <Fantasma
                                  key={i}
                                  className="h-[52px] rounded-[10px]"
                                />
                              ))}
                            </div>
                          ) : times.length === 0 ? (
                            <Vazio
                              titulo="Nenhum horário livre neste dia"
                              detalhe="Escolha outra data no calendário."
                            />
                          ) : (
                            <>
                              {manha.length > 0 ? (
                                <TimeGroup
                                  label="Manhã"
                                  slots={manha}
                                  selected={slot}
                                  onSelect={setSlot}
                                />
                              ) : null}
                              {tarde.length > 0 ? (
                                <TimeGroup
                                  label="Tarde"
                                  slots={tarde}
                                  selected={slot}
                                  onSelect={setSlot}
                                />
                              ) : null}
                              {noite.length > 0 ? (
                                <TimeGroup
                                  label="Noite"
                                  slots={noite}
                                  selected={slot}
                                  onSelect={setSlot}
                                />
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  ) : carregandoMes ? (
                    <div className="space-y-3">
                      <Fantasma className="h-5 w-40 rounded-pill" />
                      <Fantasma className="h-4 w-24 rounded-pill" />
                    </div>
                  ) : null}
                </div>
              </div>
              </div>
            </>
          ) : null}

          {/* 3. Identificação */}
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
          <div className="animate-passo mt-6 hidden items-center justify-between gap-4 border-t border-cartao-linha pt-5 md:flex">
            <span className="min-w-0 text-body text-ink-secondary">
              {maiuscula(formatTz(new Date(slot.startsAt), fuso, "EEEE, d 'de' MMMM"))} às{" "}
              <span className="text-card tabular text-ink">{slot.label}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => irPara("identify")}>
              Continuar
            </Button>
          </div>
        ) : null}
      </div>

      {/* Barra de ação do celular: só existe quando há uma escolha para levar
          adiante. Fundo SÓLIDO e não desfocado — desfoque sobre o grão do
          balcão vira lama, e este é o alvo que não pode perder contraste. */}
      {step === "when" && slot ? (
        <div className="animate-passo fixed inset-x-0 bottom-0 z-20 border-t border-cartao-fio bg-cartao px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-sticky md:hidden">
          <div className="mx-auto flex max-w-[620px] items-center justify-between gap-3">
            <span className="min-w-0 text-caption text-ink-secondary">
              {format(new Date(slot.startsAt), "EEE, d 'de' MMM", { locale: ptBR })} às{" "}
              <span className="text-label text-ink tabular">{slot.label}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => irPara("identify")}>
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
/**
 * Seta de virar o mês.
 *
 * 44px de alvo, e o contorno é o `cartao-fio` — o mesmo fio que já se mediu em
 * 3,53:1 e que este cartão usa em todo controle. A seta desabilitada continua
 * na página, apagada: sumir com ela na última virada muda o lugar da seta que
 * ficou, e o dedo que ia repetir o gesto erra o alvo.
 */
function SetaDeMes({
  sentido,
  rotulo,
  desabilitada,
  onClick,
}: {
  sentido: 1 | -1;
  rotulo: string;
  desabilitada: boolean;
  onClick: () => void;
}) {
  const Icone = sentido === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitada}
      aria-label={rotulo}
      className={cn(
        "flex size-11 items-center justify-center rounded-[12px] ring-1 transition-colors",
        desabilitada
          ? "text-ink-muted ring-cartao-linha"
          : "text-ink ring-cartao-fio hover:bg-cartao-sunken",
      )}
    >
      <Icone aria-hidden className="size-5" />
    </button>
  );
}

function Fantasma({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={style}
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
          <span className="carimbo inline-flex items-center gap-1.5 rounded-pill bg-positive-soft px-2.5 py-1 text-meta font-semibold uppercase tracking-[0.1em] text-positive">
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

        {/* As quatro linhas entram na ordem de leitura, atrás do carimbo: o
            bilhete se escreve, em vez de já estar escrito. */}
        <dl className="mt-5 space-y-3.5 px-6 sm:px-8">
          <LinhaBilhete rotulo="Serviço" valor={confirmation.serviceName} atraso={420} />
          <LinhaBilhete rotulo="Com" valor={confirmation.professionalName} atraso={480} />
          <LinhaBilhete
            rotulo="Onde"
            valor={confirmation.branchName}
            complemento={confirmation.branchAddress ?? undefined}
            atraso={540}
          />
          <LinhaBilhete
            rotulo="Valor"
            valor={precoPartido(service.priceCents).join(" ")}
            atraso={600}
          />
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
  atraso = 0,
}: {
  rotulo: string;
  valor: string;
  complemento?: string;
  /** Milissegundos até esta linha entrar, para o bilhete se escrever em ordem. */
  atraso?: number;
}) {
  return (
    <div
      className="entrada-escalonada flex items-baseline justify-between gap-4"
      style={{ "--atraso": `${atraso}ms` } as React.CSSProperties}
    >
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
      {/* Quatro colunas no celular, seis na largura toda, três quando a lista
          vira coluna lateral de 252px. */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-3">
        {slots.map((item, i) => {
          const active = selected?.startsAt === item.startsAt;
          return (
            <button
              key={item.startsAt}
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={active}
              style={{ "--atraso": `${Math.min(i * 22, 200)}ms` } as React.CSSProperties}
              className={cn(
                // 52px de alvo: é um dedo, à noite, deitada, numa grade
                // encostada em outra grade.
                //
                // `scroll-mb-12` é por causa do esmaecimento no pé da coluna do
                // desktop: ao tabular para um horário fora de vista o navegador
                // rola o mínimo, e o mínimo pararia o chip exatamente dentro
                // dos 40px que se apagam. Foco visível que ninguém vê não é
                // foco visível.
                // O horário escolhido não muda só de cor: ele SALTA um pouco à
                // frente dos outros, com a sombra curta de quem está por cima.
                // Numa grade de quarenta chips iguais, cor sozinha se perde —
                // e é a única escolha que a cliente precisa reencontrar depois
                // de rolar a lista inteira.
                "entrada-escalonada h-[52px] scroll-mb-12 rounded-[10px] text-body tabular transition-[background-color,color,transform,box-shadow] duration-[160ms] ease-[var(--ease-out-quint)] active:scale-[0.96]",
                active
                  ? "scale-[1.04] bg-accent font-bold text-white shadow-[0_8px_18px_-8px_color-mix(in_oklab,var(--color-accent)_70%,transparent)]"
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
 * São três — escolher o que fazer, escolher quando, dizer quem é —, e a
 * unidade não é um deles: com duas lojas da mesma casa, a pergunta "em qual?"
 * é um detalhe do "quando", e virou uma pílula ao lado do calendário.
 *
 * Continuam sendo três de verdade, e não três por promessa: a clínica com um
 * serviço publicado só tem dois, porque "o que você quer fazer?" com uma opção
 * só é pergunta que já tem resposta. Vive fora do componente para poder ser
 * provada sem navegador — contador de passo que mente é o tipo de defeito que
 * ninguém nota até a cliente perguntar quantas telas ainda faltam.
 */
export function passosDaClinica(quantosServicos: number): string[] {
  return [...(quantosServicos > 1 ? ["Serviço"] : []), "Dia e hora", "Seus dados"];
}

/**
 * A TRILHA — um traço por passo, e o passo vencido pintado de esmalte.
 *
 * A linha "1 DE 4 · SERVIÇO" dizia a mesma coisa e não mostrava nada: para
 * saber o quanto falta, a cliente tinha que fazer a conta. Aqui a distância é
 * a própria imagem — e o traço não aparece preenchido, ele se preenche, da
 * esquerda para a direita, no mesmo gesto de quem passa esmalte.
 *
 * O traço do passo aberto fica pela metade: cheio ele diria "terminado", vazio
 * diria "nem começou", e nenhum dos dois é verdade enquanto a cliente está
 * dentro dele.
 */
function Trilha({ passos, atual }: { passos: string[]; atual: number }) {
  return (
    <nav aria-label="Etapas do agendamento" className="mb-6 flex gap-2">
      {passos.map((rotulo, i) => {
        const vencido = i < atual;
        const aqui = i === atual;
        return (
          <div key={rotulo} className="min-w-0 flex-1" aria-current={aqui ? "step" : undefined}>
            <div className="h-[3px] overflow-hidden rounded-pill bg-cartao-linha">
              {/*
                `scaleX` com origem à esquerda, e não `width`: largura anima no
                layout — reflui a página inteira a cada quadro — e o traço de
                3px chega tremendo. A transformação roda na composição.
              */}
              <div
                className="trilha-enche h-full origin-left rounded-pill bg-accent transition-transform duration-[460ms] ease-[var(--ease-out-quint)]"
                style={{
                  transform: `scaleX(${vencido ? 1 : aqui ? 0.42 : 0})`,
                  "--atraso": `${180 + i * 90}ms`,
                } as React.CSSProperties}
              />
            </div>
            <p
              className={cn(
                "mt-2 flex min-w-0 items-center gap-1 text-meta transition-colors duration-200",
                aqui
                  ? "font-semibold text-ink"
                  : vencido
                    ? "text-ink-secondary"
                    : "text-ink-tertiary",
              )}
            >
              {/* O visto cai no lugar com o mesmo salto da postiça: é a única
                  recompensa da trilha, e ela precisa ser vista acontecer. */}
              {vencido ? (
                <Check aria-hidden className="animate-postica-in size-3 shrink-0 text-accent" />
              ) : null}
              <span className="truncate">{rotulo}</span>
            </p>
          </div>
        );
      })}
    </nav>
  );
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
