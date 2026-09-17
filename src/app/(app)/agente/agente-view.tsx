"use client";

import {
  BatteryFull,
  Bot,
  CircleAlert,
  KeyRound,
  Pencil,
  Play,
  Plus,
  Send,
  Signal,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wifi,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  apenasSituacoesConhecidas,
  montarPresetPadrao,
  PADRAO,
  PERMISSOES_DO_PADRAO,
  type Prontidao,
  ROTULO_DO_EMOJI,
  ROTULO_DO_TOM,
  SITUACOES_DE_TRANSFERENCIA,
  type SituacaoDeTransferencia,
  TONS,
  type Tom,
  USOS_DE_EMOJI,
  type UsoDeEmoji,
} from "@/domain/agente";
import { cn } from "@/lib/utils";
import {
  ativarAgentePadraoAction,
  deleteKnowledgeAction,
  saveAgentAction,
  saveKnowledgeAction,
  savePermissionsAction,
  simulateAgentAction,
} from "./actions";

type Modo = "padrao" | "personalizado";

type Config = {
  name: string;
  status: "off" | "testing" | "active";
  enabled: boolean;
  instructions: string;
  mode: Modo;
  tone: string;
  emojiUse: string;
  goal: string | null;
  handoffWhen: string[] | null;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  debounceWindowSeconds: number;
  responseDelaySeconds: number;
  pauseOnHumanReply: boolean;
  respondGroups: boolean;
  businessHoursOnly: boolean;
  outOfHoursMessage: string | null;
  maxTurnsPerMinutePerOrg: number;
  maxTurnsPerMinutePerContact: number;
  extendedThinking: boolean;
};

type Permissions = {
  readCustomer: boolean;
  readAppointments: boolean;
  readServices: boolean;
  readAvailability: boolean;
  readKnowledge: boolean;
  createAppointment: boolean;
  rescheduleAppointment: boolean;
  cancelAppointment: boolean;
  updateCustomer: boolean;
  addNote: boolean;
  transferToHuman: boolean;
};

type Knowledge = { id: number; title: string; content: string };
type ModelInfo = { id: string; label: string; provider: string; note?: string };
type Tab = "comportamento" | "ferramentas" | "conhecimento" | "testar";

/**
 * Os três modos vêm do entur-os-crm e resolvem um problema concreto: dava medo
 * ligar o agente sem ver o que ele responde. "Teste" existe para experimentar
 * com segurança — ele roda no simulador e não fala com cliente nenhum.
 */
const MODES: Array<{ id: Config["status"]; label: string; description: string }> = [
  { id: "off", label: "Desligado", description: "Não responde em lugar nenhum." },
  { id: "testing", label: "Teste", description: "Responde só aqui no simulador." },
  { id: "active", label: "Atendendo", description: "Responde clientes de verdade no WhatsApp." },
];

const PERMISSION_GROUPS: Array<{
  title: string;
  description: string;
  items: Array<{ key: keyof Permissions; label: string; hint: string }>;
}> = [
  {
    title: "Consultar",
    description: "O que o agente pode ler para responder.",
    items: [
      { key: "readServices", label: "Catálogo", hint: "Serviços, duração e preço." },
      { key: "readAvailability", label: "Horários livres", hint: "Consulta a agenda antes de oferecer horário." },
      { key: "readCustomer", label: "Ficha do cliente", hint: "Nome, histórico e anotações." },
      { key: "readAppointments", label: "Agendamentos do cliente", hint: "Necessário para remarcar e cancelar." },
      { key: "readKnowledge", label: "Base de conhecimento", hint: "Políticas e informações do negócio." },
    ],
  },
  {
    title: "Agir",
    description: "O que o agente pode mudar sozinho. Comece desligado e libere conforme confiar.",
    items: [
      { key: "createAppointment", label: "Agendar", hint: "Marca horário direto na agenda." },
      { key: "rescheduleAppointment", label: "Remarcar", hint: "Muda um horário existente." },
      { key: "cancelAppointment", label: "Cancelar", hint: "Cancela um agendamento." },
      { key: "updateCustomer", label: "Completar cadastro", hint: "Nome, e-mail e aniversário." },
      { key: "addNote", label: "Anotar sobre o cliente", hint: "Preferências e observações." },
      { key: "transferToHuman", label: "Transferir para humano", hint: "Devolve a conversa para a fila." },
    ],
  },
];

export function AgentView({
  organizationName,
  models,
  apiKeyPresent,
  whatsappConnected,
  agentExists,
  prontidao,
  config: initialConfig,
  permissions: initialPermissions,
  knowledge: initialKnowledge,
}: {
  organizationName: string;
  models: ModelInfo[];
  apiKeyPresent: boolean;
  whatsappConnected: boolean;
  agentExists: boolean;
  prontidao: Prontidao;
  config: Config;
  permissions: Permissions;
  knowledge: Knowledge[];
}) {
  const [tab, setTab] = useState<Tab>("comportamento");
  const [config, setConfig] = useState(initialConfig);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [saving, startSaving] = useTransition();

  /**
   * `null` é a tela de escolha. Conta que nunca configurou começa nela; conta
   * que já tem agente entra direto no modo dela e só volta aqui se pedir.
   *
   * Sem isto, quem chega pela primeira vez cai num formulário cheio, idêntico
   * ao de um agente já montado e desligado — que é exatamente o que fez
   * ninguém em produção conseguir ligar a agente até hoje.
   */
  const [modo, setModo] = useState<Modo | null>(agentExists ? initialConfig.mode : null);
  const [ativada, setAtivada] = useState(false);

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function saveConfig() {
    startSaving(async () => {
      const result = await saveAgentAction(config);
      if (result.ok) toast.success("Agente salvo");
      else toast.error(result.error);
    });
  }

  function savePermissions(next: Permissions) {
    setPermissions(next);
    startSaving(async () => {
      const result = await savePermissionsAction(next);
      if (!result.ok) {
        toast.error(result.error);
        setPermissions(permissions);
      }
    });
  }

  if (modo === null) {
    return (
      <EscolhaDeModo
        organizationName={organizationName}
        onEscolher={(escolhido) => {
          setModo(escolhido);
          setAtivada(false);
        }}
      />
    );
  }

  if (modo === "padrao") {
    return (
      <ConfiguracaoPadrao
        ativada={ativada}
        config={config}
        onAplicado={(ligou) => {
          // A aba de ferramentas precisa passar a mostrar o que a ativação
          // concedeu; senão o primeiro toque ali revoga tudo de volta.
          setPermissions({ ...PERMISSOES_DO_PADRAO });
          if (ligou) setAtivada(true);
        }}
        onPersonalizar={() => setModo("personalizado")}
        organizationName={organizationName}
        prontidao={prontidao}
        set={set}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-title text-ink">Agente de IA</h1>
          <Badge tone={config.status === "active" && config.enabled ? "positive" : config.status === "testing" ? "info" : "neutral"}>
            <Bot className="size-3" aria-hidden />
            {config.status === "active" && config.enabled ? "Atendendo" : config.status === "testing" ? "Em teste" : "Desligado"}
          </Badge>
          {/* O caminho de volta. Sem ele, escolher "configurar do zero" uma vez
              tranca a conta no modo avançado para sempre. */}
          <button
            className="ml-auto min-h-11 text-caption text-ink-secondary hover:text-ink"
            onClick={() => setModo("padrao")}
            type="button"
          >
            Usar a configuração padrão
          </button>
        </div>
        <p className="mt-1 text-body text-ink-secondary">
          Um atendente que responde no WhatsApp de {organizationName}: consulta a agenda, informa preço e marca horário,
          dentro do que você permitir.
        </p>
      </header>

      {!apiKeyPresent ? (
        <p className="mb-4 flex items-start gap-1.5 rounded-control bg-attention-soft px-3 py-2 text-caption text-attention">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Falta a chave do provedor de IA no servidor. Sem ela o agente não responde, mesmo ligado.
        </p>
      ) : null}
      {config.status === "active" && !whatsappConnected ? (
        <p className="mb-4 flex items-start gap-1.5 rounded-control bg-attention-soft px-3 py-2 text-caption text-attention">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          O WhatsApp não está conectado.{" "}
          <Link href="/whatsapp" className="underline">
            Conectar agora
          </Link>
        </p>
      ) : null}

      <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist">
        {(
          [
            ["comportamento", "Comportamento"],
            ["ferramentas", "Ferramentas"],
            ["conhecimento", "Conhecimento"],
            ["testar", "Testar"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "shrink-0 rounded-control px-3 py-1.5 text-label font-medium transition-colors",
              tab === id ? "bg-accent-soft text-accent" : "text-ink-secondary hover:bg-surface-sunken",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "comportamento" ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Modo de operação" />
            <div className="flex flex-col gap-2 p-4 pt-0">
              {MODES.map((mode) => (
                <label
                  key={mode.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-control border p-3 transition-colors",
                    config.status === mode.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-sunken",
                  )}
                >
                  <input
                    type="radio"
                    name="modo"
                    className="mt-1"
                    checked={config.status === mode.id}
                    onChange={() => set("status", mode.id)}
                  />
                  <span>
                    <span className="block text-label text-ink">{mode.label}</span>
                    <span className="block text-caption text-ink-secondary">{mode.description}</span>
                  </span>
                </label>
              ))}

              <Toggle
                label="Ligado"
                hint="Desligar aqui para o agente parar na hora, sem perder a configuração."
                checked={config.enabled}
                onChange={(v) => set("enabled", v)}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Personalidade e instruções" />
            <div className="flex flex-col gap-3 p-4 pt-0">
              <Field label="Nome do agente" hint="É como ele se apresenta ao cliente.">
                <Input value={config.name} onChange={(e) => set("name", e.target.value)} maxLength={60} />
              </Field>
              <Field
                label="Instruções"
                hint="Escreva como você orientaria uma recepcionista nova: tom, o que oferecer, o que nunca fazer, quando chamar alguém."
              >
                <Textarea
                  value={config.instructions}
                  onChange={(e) => set("instructions", e.target.value)}
                  rows={10}
                  maxLength={8000}
                  placeholder={"Exemplo: Você atende o salão com simpatia e objetividade.\nSempre confirme o serviço antes de oferecer horário.\nNunca prometa desconto: se pedirem, transfira para uma atendente."}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Ritmo da conversa" />
            <div className="flex flex-col gap-3 p-4 pt-0">
              <Field
                label="Esperar o cliente terminar de escrever (segundos)"
                hint="O cliente costuma mandar três mensagens seguidas. Esperar evita três respostas soltas."
              >
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={config.debounceWindowSeconds}
                  onChange={(e) => set("debounceWindowSeconds", Number(e.target.value))}
                />
              </Field>
              <Field label="Intervalo mínimo entre respostas (segundos)" hint="Zero responde assim que estiver pronto.">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={config.responseDelaySeconds}
                  onChange={(e) => set("responseDelaySeconds", Number(e.target.value))}
                />
              </Field>
              <Toggle
                label="Recuar quando uma atendente responder"
                hint="Assim que uma pessoa escreve na conversa, o agente para de responder ali."
                checked={config.pauseOnHumanReply}
                onChange={(v) => set("pauseOnHumanReply", v)}
              />
              <Toggle
                label="Responder em grupos"
                hint="Normalmente desligado: grupo não é atendimento."
                checked={config.respondGroups}
                onChange={(v) => set("respondGroups", v)}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Modelo e limites" />
            <div className="flex flex-col gap-3 p-4 pt-0">
              <Field label="Modelo" hint="Modelos mais capazes entendem melhor pedidos confusos; os mais rápidos custam menos.">
                <select
                  value={config.model}
                  onChange={(e) => set("model", e.target.value)}
                  className="h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink"
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.note ? ` — ${model.note}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Toggle
                label="Pensar antes de responder"
                hint="Melhora casos difíceis e deixa a resposta um pouco mais lenta."
                checked={config.extendedThinking}
                onChange={(v) => set("extendedThinking", v)}
              />
              <Field label="Tamanho máximo da resposta (tokens)" hint="600 dá mensagens curtas, no tom de WhatsApp.">
                <Input
                  type="number"
                  min={100}
                  max={4000}
                  value={config.maxOutputTokens}
                  onChange={(e) => set("maxOutputTokens", Number(e.target.value))}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Respostas por minuto (clínica)" hint="Trava de segurança contra laço de mensagens.">
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={config.maxTurnsPerMinutePerOrg}
                    onChange={(e) => set("maxTurnsPerMinutePerOrg", Number(e.target.value))}
                  />
                </Field>
                <Field label="Respostas por minuto (mesma conversa)" hint="Evita responder em rajada ao mesmo cliente.">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={config.maxTurnsPerMinutePerContact}
                    onChange={(e) => set("maxTurnsPerMinutePerContact", Number(e.target.value))}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <div className="sticky bottom-4 flex justify-end">
            <Button variant="primary" size="md" onClick={saveConfig} loading={saving}>
              Salvar
            </Button>
          </div>
        </div>
      ) : null}

      {tab === "ferramentas" ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-secondary">
            O que estiver desligado aqui não é oferecido ao agente. As instruções podem pedir o que quiserem, quem
            decide é esta lista.
          </p>
          {PERMISSION_GROUPS.map((group) => (
            <Card key={group.title}>
              <CardHeader title={group.title} />
              <div className="flex flex-col gap-2 p-4 pt-0">
                <p className="text-caption text-ink-secondary">{group.description}</p>
                {group.items.map((item) => (
                  <Toggle
                    key={item.key}
                    label={item.label}
                    hint={item.hint}
                    checked={permissions[item.key]}
                    onChange={(value) => savePermissions({ ...permissions, [item.key]: value })}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "conhecimento" ? (
        <KnowledgeTab knowledge={knowledge} onChange={setKnowledge} />
      ) : null}

      {tab === "testar" ? <SimulatorTab agentName={config.name} /> : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-label text-ink">{label}</span>
        <span className="block text-caption text-ink-secondary">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-5 shrink-0 accent-accent"
      />
    </label>
  );
}

function KnowledgeTab({
  knowledge,
  onChange,
}: {
  knowledge: Knowledge[];
  onChange: (next: Knowledge[]) => void;
}) {
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, startSaving] = useTransition();

  function startNew() {
    setEditing({ id: 0, title: "", content: "" });
    setTitle("");
    setContent("");
  }

  function save() {
    startSaving(async () => {
      const result = await saveKnowledgeAction({
        id: editing?.id && editing.id > 0 ? editing.id : undefined,
        title,
        content,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Material salvo");
      setEditing(null);
      // A lista real volta no próximo carregamento da rota; o estado local
      // mantém a tela coerente enquanto isso.
      onChange(
        editing?.id && editing.id > 0
          ? knowledge.map((k) => (k.id === editing.id ? { ...k, title, content } : k))
          : [...knowledge, { id: Date.now(), title, content }],
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-body text-ink-secondary">
          O que o agente precisa saber e não está no catálogo nem na agenda: política de cancelamento, formas de
          pagamento, endereço, cuidados antes e depois do procedimento.
        </p>
        <Button size="sm" variant="secondary" onClick={startNew} className="shrink-0">
          <Plus aria-hidden />
          Novo
        </Button>
      </div>

      {editing ? (
        <Card>
          <CardHeader title={editing.id > 0 ? "Editar material" : "Novo material"} />
          <div className="flex flex-col gap-3 p-4 pt-0">
            <Field label="Título">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Política de cancelamento" />
            </Field>
            <Field label="Conteúdo">
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" size="md" onClick={save} loading={saving} disabled={!title.trim() || !content.trim()}>
                Salvar
              </Button>
              <Button size="md" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {knowledge.length === 0 && !editing ? (
        <p className="rounded-control bg-surface-sunken px-3 py-6 text-center text-caption text-ink-secondary">
          Nenhum material ainda. Sem isso, o agente responde só o que está no catálogo e na agenda.
        </p>
      ) : null}

      {knowledge.map((item) => (
        <Card key={item.id}>
          <CardHeader
            title={item.title}
            action={
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(item);
                    setTitle(item.title);
                    setContent(item.content);
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`Remover "${item.title}"?`)) return;
                    const result = await deleteKnowledgeAction(item.id);
                    if (result.ok) {
                      onChange(knowledge.filter((k) => k.id !== item.id));
                      toast.success("Material removido");
                    } else {
                      toast.error(result.error);
                    }
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            }
          />
          <p className="line-clamp-3 whitespace-pre-wrap px-4 pb-4 text-caption text-ink-secondary">{item.content}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * A porta de entrada. Duas escolhas, e uma delas é claramente a recomendada.
 *
 * O ponto inteiro desta tela é que a manicure não precise entender de IA para
 * usar IA: a coluna da esquerda não pede nada dela, e a da direita avisa, sem
 * assustar, para quem ela serve.
 */
function EscolhaDeModo({
  organizationName,
  onEscolher,
}: {
  organizationName: string;
  onEscolher: (modo: Modo) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[820px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-title text-ink">Agente de IA</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Uma atendente que responde no WhatsApp de {organizationName}: informa preço, consulta a agenda e marca
          horário.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col border-accent/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-pill bg-accent-soft text-accent">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <Badge tone="positive">Recomendado</Badge>
          </div>
          <h2 className="text-card text-ink">Configuração padrão</h2>
          <p className="mt-1.5 flex-1 text-body text-ink-secondary">
            Ative uma agente pronta para atender suas clientes, consultar horários, fazer e remarcar agendamentos,
            tirar dúvidas e apresentar seus serviços. Você não escreve nada.
          </p>
          <Button className="mt-4" onClick={() => onEscolher("padrao")} variant="primary">
            Usar a configuração padrão
          </Button>
        </Card>

        <Card className="flex flex-col p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-pill bg-surface-sunken text-ink-secondary">
              <SlidersHorizontal className="size-5" aria-hidden />
            </span>
          </div>
          <h2 className="text-card text-ink">Configuração personalizada</h2>
          <p className="mt-1.5 flex-1 text-body text-ink-secondary">
            Escreva o comportamento, a personalidade, a linguagem e as regras da sua agente, e escolha uma a uma as
            ações que ela pode executar.
          </p>
          <p className="mt-3 rounded-control bg-surface-sunken px-3 py-2 text-caption text-ink-secondary">
            Indicada para quem quer um comportamento específico. Se você quer uma agente pronta para atender e
            agendar, use a configuração padrão.
          </p>
          <Button className="mt-4" onClick={() => onEscolher("personalizado")} variant="secondary">
            Configurar do zero
          </Button>
        </Card>
      </div>
    </div>
  );
}

/** Um seletor de três opções, do tamanho de um dedo. */
function Escolha<T extends string>({
  opcoes,
  rotulos,
  valor,
  onChange,
}: {
  opcoes: readonly T[];
  rotulos: Record<T, string>;
  valor: T;
  onChange: (valor: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((opcao) => (
        <button
          aria-pressed={valor === opcao}
          className={cn(
            "min-h-11 rounded-control px-3 text-label font-medium transition-colors",
            valor === opcao
              ? "bg-accent-soft text-accent ring-1 ring-accent/40"
              : "bg-surface-sunken text-ink-secondary hover:text-ink",
          )}
          key={opcao}
          onClick={() => onChange(opcao)}
          type="button"
        >
          {rotulos[opcao]}
        </button>
      ))}
    </div>
  );
}

function ConfiguracaoPadrao({
  ativada,
  config,
  onAplicado,
  onPersonalizar,
  organizationName,
  prontidao,
  set,
}: {
  ativada: boolean;
  config: Config;
  onAplicado: (ligou: boolean) => void;
  onPersonalizar: () => void;
  organizationName: string;
  prontidao: Prontidao;
  set: <K extends keyof Config>(key: K, value: Config[K]) => void;
}) {
  const [salvando, startSalvando] = useTransition();
  const [testando, setTestando] = useState(false);

  // Filtra chave que uma versão anterior da tela gravou e que não existe mais,
  // para a caixa de marcar não guardar um valor que ninguém mostra.
  const transferir = apenasSituacoesConhecidas(config.handoffWhen ?? PADRAO.transferirQuando);
  const faltando = prontidao.itens.filter((item) => !item.ok);

  /** O que o BANCO diz, não o que a tela lembra de ter clicado. */
  const noAr = config.status === "active" && config.enabled;

  function aplicar(estado: "ativo" | "teste" | "desligado") {
    startSalvando(async () => {
      const resultado = await ativarAgentePadraoAction({
        name: config.name,
        tone: config.tone,
        emojiUse: config.emojiUse,
        goal: config.goal,
        handoffWhen: transferir,
        estado,
      });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      /**
       * A tela precisa passar a acreditar no que acabou de gravar.
       *
       * Sem isto, `config` continua com o estado anterior e o próximo Salvar
       * dos ajustes avançados regrava status "off" por cima da agente recém
       * ativada — desligando, em silêncio, o que a dona acabou de ligar.
       */
      set("mode", "padrao");
      set("status", estado === "ativo" ? "active" : estado === "teste" ? "testing" : "off");
      set("enabled", estado === "ativo");

      onAplicado(estado === "ativo");

      if (estado === "teste") {
        setTestando(true);
        toast.success("Pronta para testar. Ela ainda não responde suas clientes.");
      } else {
        toast.success("Agente desligada. Ela não responde mais suas clientes.");
      }
    });
  }

  /**
   * Sair do padrão sem perder o comportamento.
   *
   * No modo padrão o campo de instruções fica vazio, porque o comportamento vem
   * do preset em código. Mandar a dona para a tela avançada assim entregaria
   * uma caixa em branco e, no primeiro Salvar, uma agente sem preset e sem
   * instruções: sem comportamento nenhum. O preset é materializado no texto,
   * para ela editar a partir do que já existia.
   */
  function irParaPersonalizado() {
    if (!config.instructions.trim()) {
      set(
        "instructions",
        montarPresetPadrao({
          tom: config.tone as Tom,
          emoji: config.emojiUse as UsoDeEmoji,
          objetivo: config.goal,
          transferirQuando: transferir,
        }),
      );
    }
    onPersonalizar();
  }

  if (ativada) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-4 py-6 md:px-6 md:py-8">
        <Card className="p-6 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-pill bg-accent-soft text-accent">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <h1 className="text-title text-ink">Sua agente está pronta</h1>
          <p className="mx-auto mt-2 max-w-[460px] text-body text-ink-secondary">
            {config.name} já consulta seus serviços, seus preços e sua agenda para atender suas clientes e marcar
            horário no WhatsApp de {organizationName}.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => setTestando((antes) => !antes)} variant="primary">
              {testando ? "Fechar o teste" : "Testar minha agente"}
            </Button>
            <Button onClick={irParaPersonalizado} variant="secondary">
              Ver ajustes avançados
            </Button>
          </div>
          {!prontidao.prontaParaResponder ? (
            <p className="mt-4 text-caption text-attention">
              Falta conectar o WhatsApp para ela falar com suas clientes.
            </p>
          ) : null}
        </Card>
        {testando ? (
          <div className="mt-4">
            <SimulatorTab agentName={config.name} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-title text-ink">Configuração padrão</h1>
          <Badge tone={noAr ? "positive" : config.status === "testing" ? "info" : "neutral"}>
            <Bot className="size-3" aria-hidden />
            {noAr ? "Atendendo" : config.status === "testing" ? "Em teste" : "Desligada"}
          </Badge>
        </div>
        <p className="mt-1 text-body text-ink-secondary">
          Ela já sabe atender. Estes ajustes são só para ela parecer com você.
        </p>
      </header>

      {/*
        A prontidão vem antes dos ajustes de propósito. A promessa "ative e ela
        já consulta seus serviços e sua agenda" é falsa numa conta vazia, e conta
        vazia é o caso comum: medido em produção, há contas reais com zero
        serviço, zero profissional e zero jornada. Ativar ali entregaria uma
        agente que não sabe nenhum preço e nunca acha horário.
      */}
      {faltando.length > 0 ? (
        <Card className="mb-4 border-attention/40 p-4">
          <h2 className="text-card text-ink">Falta pouco para ela atender</h2>
          <p className="mt-1 text-caption text-ink-secondary">
            Ela nunca inventa informação, então precisa do seu cadastro para responder.
          </p>
          <ul className="mt-3 space-y-2">
            {faltando.map((item) => (
              <li className="flex items-start gap-2.5" key={item.chave}>
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-label text-ink">{item.rotulo}</span>
                  <span className="block text-caption text-ink-secondary">{item.comoResolver}</span>
                </span>
                <Link className="shrink-0 text-label font-semibold text-accent hover:underline" href={item.href}>
                  {item.acao}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader title="Como ela se apresenta" />
        <div className="flex flex-col gap-4 p-4 pt-0">
          <Field hint="É o nome que a cliente vê no WhatsApp." label="Nome da agente">
            <Input maxLength={60} onChange={(e) => set("name", e.target.value)} value={config.name} />
          </Field>
          <Field label="Tom de conversa">
            <Escolha
              onChange={(valor) => set("tone", valor)}
              opcoes={TONS}
              rotulos={ROTULO_DO_TOM}
              valor={config.tone as Tom}
            />
          </Field>
          <Field label="Emojis">
            <Escolha
              onChange={(valor) => set("emojiUse", valor)}
              opcoes={USOS_DE_EMOJI}
              rotulos={ROTULO_DO_EMOJI}
              valor={config.emojiUse as UsoDeEmoji}
            />
          </Field>
          <Field hint="Em uma frase, o que ela deve buscar em cada conversa." label="Objetivo principal">
            <Input
              maxLength={200}
              onChange={(e) => set("goal", e.target.value || null)}
              placeholder={PADRAO.objetivo}
              value={config.goal ?? ""}
            />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Quando chamar você" />
        <div className="flex flex-col gap-2 p-4 pt-0">
          <p className="text-caption text-ink-secondary">
            Quando a cliente pedir para falar com uma pessoa, ela sempre passa para você. Estas são as outras
            situações.
          </p>
          {(Object.keys(SITUACOES_DE_TRANSFERENCIA) as SituacaoDeTransferencia[]).map((chave) => {
            const marcada = transferir.includes(chave);
            return (
              <label className="flex min-h-11 items-center gap-2.5 text-body text-ink" key={chave}>
                <input
                  checked={marcada}
                  className="size-4 accent-[var(--color-accent)]"
                  onChange={() =>
                    set(
                      "handoffWhen",
                      marcada ? transferir.filter((item) => item !== chave) : [...transferir, chave],
                    )
                  }
                  type="checkbox"
                />
                {SITUACOES_DE_TRANSFERENCIA[chave].rotulo}
              </label>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!prontidao.prontaParaAtender}
          loading={salvando}
          onClick={() => aplicar("ativo")}
          variant="primary"
        >
          {noAr ? "Salvar ajustes" : "Ativar agente"}
        </Button>
        {noAr ? (
          <Button loading={salvando} onClick={() => aplicar("desligado")} variant="secondary">
            Desligar agente
          </Button>
        ) : (
          <Button loading={salvando} onClick={() => aplicar("teste")} variant="secondary">
            Só preparar e testar
          </Button>
        )}
        <Button loading={salvando} onClick={() => setTestando((antes) => !antes)} variant="ghost">
          {testando ? "Fechar o teste" : "Testar"}
        </Button>
        <button
          className="ml-auto min-h-11 text-caption text-ink-secondary hover:text-ink"
          onClick={irParaPersonalizado}
          type="button"
        >
          Prefiro configurar do zero
        </button>
      </div>

      {testando ? (
        <div className="mt-4">
          <SimulatorTab agentName={config.name} />
        </div>
      ) : null}
    </div>
  );
}

type SimMessage = { role: "user" | "assistant"; content: string; tools?: string[] };

/**
 * As cores daqui são do WHATSAPP, de propósito, e por isso não entram no tema.
 *
 * A regra da casa é que cor fora do tema é cor que ninguém acha quando a marca
 * muda — mas estas não são a nossa marca: são a do aplicativo que estamos
 * imitando. Se a nossa paleta mudar, este celular tem que continuar parecendo o
 * WhatsApp, senão ele deixa de responder a pergunta que o simulador existe para
 * responder: "como isso vai chegar para a minha cliente?".
 */
const ZAP = {
  fundo: "#0b141a",
  barra: "#202c33",
  balaoDela: "#005c4b",
  balaoDele: "#202c33",
  texto: "#e9edef",
  apagado: "#8696a0",
};

/**
 * O celular: moldura, ilha e barra de status.
 *
 * Nada aqui é interativo. A ilha e os ícones de sinal são `aria-hidden` — quem
 * usa leitor de tela não precisa ouvir que existe uma bateria desenhada.
 */
function Telefone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[344px] rounded-[46px] bg-[#101014] p-2.5 shadow-[0_24px_60px_-18px_rgba(45,32,59,.45)] ring-1 ring-white/10">
      <div
        className="relative flex h-[600px] flex-col overflow-hidden rounded-[38px]"
        style={{ backgroundColor: ZAP.fundo }}
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-2 z-20 h-[26px] w-[92px] -translate-x-1/2 rounded-pill bg-black"
        />
        {/* Hora fixa, e não o relógio de verdade: é uma maquete, e relógio vivo
            aqui renderiza diferente no servidor e no navegador — o mesmo defeito
            de hidratação que já custou caro no inbox. */}
        <div
          aria-hidden
          className="flex shrink-0 items-center justify-between px-6 pb-1 pt-3 text-caption font-semibold"
          style={{ color: ZAP.texto }}
        >
          <span>09:41</span>
          <span className="flex items-center gap-1">
            <Signal className="size-3.5" />
            <Wifi className="size-3.5" />
            <BatteryFull className="size-4" />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function SimulatorTab({ agentName }: { agentName: string }) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [running, startRunning] = useTransition();

  function send() {
    const message = draft.trim();
    if (!message) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setDraft("");

    startRunning(async () => {
      const result = await simulateAgentAction({ message, history, customerId: null });
      if (!result.ok) {
        toast.error(result.error);
        setMessages((prev) => prev.slice(0, -1));
        setDraft(message);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply, tools: result.toolsUsed }]);
    });
  }

  const fimDaConversa = useRef<HTMLDivElement>(null);

  // A conversa rola dentro do celular; sem isto a resposta nova nasce fora de
  // vista e o simulador parece não ter respondido.
  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, running]);

  const inicial = agentName.trim().charAt(0).toUpperCase() || "A";

  return (
    <Card>
      <CardHeader title="Simulador" />
      <div className="flex flex-col gap-4 p-4 pt-0">
        <p className="text-caption text-ink-secondary">
          Conversa de teste com o mesmo prompt, as mesmas ferramentas e o mesmo tratamento de texto do atendimento
          real. Nada é enviado para clientes.
        </p>

        <Telefone>
          {/* Cabeçalho da conversa. O "digitando…" vive aqui, e não no corpo,
              porque é onde o WhatsApp põe — e porque no corpo ele empurrava as
              mensagens a cada resposta. */}
          <div
            className="flex shrink-0 items-center gap-3 px-4 py-2.5"
            style={{ backgroundColor: ZAP.barra }}
          >
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent text-label font-semibold text-white"
            >
              {inicial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium" style={{ color: ZAP.texto }}>
                {agentName}
              </span>
              <span className="block text-caption" style={{ color: ZAP.apagado }}>
                {running ? "digitando…" : "disponível"}
              </span>
            </span>
          </div>

          {/*
            O corpo. A trama de pontos é sugestão do papel de parede do
            aplicativo, não a arte dele: dois gradientes radiais de 4% a 28px,
            o suficiente para o fundo não ser uma chapa e sem copiar desenho de
            ninguém.
          */}
          <div
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-4"
            style={{
              backgroundImage:
                "radial-gradient(circle at 25% 25%, rgba(233,237,239,.04) 1.5px, transparent 1.6px), radial-gradient(circle at 75% 75%, rgba(233,237,239,.04) 1.5px, transparent 1.6px)",
              backgroundSize: "28px 28px",
            }}
          >
            {messages.length === 0 ? (
              <p
                className="m-auto max-w-[240px] text-center text-caption"
                style={{ color: ZAP.apagado }}
              >
                Escreva como se fosse um cliente: {'"oi, quanto custa a limpeza de pele?"'}
              </p>
            ) : (
              messages.map((message, index) => {
                const dela = message.role === "user";
                return (
                  <div
                    className={cn("flex flex-col", dela ? "items-end" : "items-start")}
                    key={index}
                  >
                    <div
                      className={cn(
                        "max-w-[82%] px-2.5 py-1.5 text-body whitespace-pre-wrap",
                        // O canto "mordido" do lado de quem falou é o que faz o
                        // balão apontar para o dono. O código antigo pedia
                        // `rounded-bubble`, que NÃO existe como token — os
                        // balões saíam com quina viva.
                        dela ? "rounded-[10px] rounded-tr-[3px]" : "rounded-[10px] rounded-tl-[3px]",
                      )}
                      style={{
                        backgroundColor: dela ? ZAP.balaoDela : ZAP.balaoDele,
                        color: ZAP.texto,
                      }}
                    >
                      {message.content}
                    </div>
                    {message.tools && message.tools.length > 0 ? (
                      /* As ferramentas que o agente usou no turno. Não existem
                         no WhatsApp de verdade — e é justamente por isso que
                         ficam FORA do balão, em etiqueta discreta: é informação
                         de quem está testando, não parte da conversa. */
                      <span
                        className="mt-1 flex flex-wrap items-center gap-1 text-meta"
                        style={{ color: ZAP.apagado }}
                      >
                        <Wrench className="size-3" aria-hidden />
                        {message.tools.join(", ")}
                      </span>
                    ) : null}
                  </div>
                );
              })
            )}
            <div ref={fimDaConversa} />
          </div>

          {/*
            A barra de escrever tem só o que FUNCIONA: campo e enviar. O modelo
            de referência mostra emoji e clipe, e eles ficaram de fora de
            propósito — botão desenhado que não faz nada é promessa falsa, e
            aqui a pessoa está justamente aprendendo o que o agente sabe fazer.
          */}
          <div
            className="flex shrink-0 items-end gap-2 px-3 py-2.5"
            style={{ backgroundColor: ZAP.barra }}
          >
            <Textarea
              className="max-h-24 min-h-10 flex-1 resize-none border-0 bg-[#2a3942] text-body text-white placeholder:text-[#8696a0] focus-visible:ring-1 focus-visible:ring-white/25"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Mensagem do cliente"
              rows={1}
              value={draft}
            />
            <Button
              aria-label="Enviar mensagem de teste"
              className="size-10 shrink-0 rounded-pill p-0"
              disabled={!draft.trim()}
              loading={running}
              onClick={send}
              size="md"
              variant="primary"
            >
              <Send aria-hidden />
            </Button>
          </div>
        </Telefone>

        {messages.length > 0 ? (
          <button
            className="self-center text-caption text-ink-secondary hover:text-ink"
            onClick={() => setMessages([])}
            type="button"
          >
            <Play className="mr-1 inline size-3" aria-hidden />
            Recomeçar conversa
          </button>
        ) : null}
      </div>
    </Card>
  );

}
