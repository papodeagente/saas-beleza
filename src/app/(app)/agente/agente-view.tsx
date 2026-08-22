"use client";

import { Bot, KeyRound, Pencil, Play, Plus, Send, Trash2, TriangleAlert, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  deleteKnowledgeAction,
  saveAgentAction,
  saveKnowledgeAction,
  savePermissionsAction,
  simulateAgentAction,
} from "./actions";

type Config = {
  name: string;
  status: "off" | "testing" | "active";
  enabled: boolean;
  instructions: string;
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
  config: initialConfig,
  permissions: initialPermissions,
  knowledge: initialKnowledge,
}: {
  organizationName: string;
  models: ModelInfo[];
  apiKeyPresent: boolean;
  whatsappConnected: boolean;
  config: Config;
  permissions: Permissions;
  knowledge: Knowledge[];
}) {
  const [tab, setTab] = useState<Tab>("comportamento");
  const [config, setConfig] = useState(initialConfig);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [saving, startSaving] = useTransition();

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

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-title text-ink">Agente de IA</h1>
          <Badge tone={config.status === "active" && config.enabled ? "positive" : config.status === "testing" ? "info" : "neutral"}>
            <Bot className="size-3" aria-hidden />
            {config.status === "active" && config.enabled ? "Atendendo" : config.status === "testing" ? "Em teste" : "Desligado"}
          </Badge>
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
            <Button size="md" onClick={saveConfig} loading={saving}>
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
        className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
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
              <Button size="md" onClick={save} loading={saving} disabled={!title.trim() || !content.trim()}>
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

type SimMessage = { role: "user" | "assistant"; content: string; tools?: string[] };

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

  return (
    <Card>
      <CardHeader title="Simulador" />
      <div className="flex flex-col gap-3 p-4 pt-0">
        <p className="text-caption text-ink-secondary">
          Conversa de teste com o mesmo prompt, as mesmas ferramentas e o mesmo tratamento de texto do atendimento
          real. Nada é enviado para clientes.
        </p>
        <div className="flex min-h-[240px] flex-col gap-2 rounded-control bg-surface-sunken p-3">
          {messages.length === 0 ? (
            <p className="m-auto text-caption text-ink-secondary">
              Escreva como se fosse um cliente: "oi, quanto custa a limpeza de pele?"
            </p>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-bubble px-3 py-2 text-body whitespace-pre-wrap",
                    message.role === "user" ? "bg-accent-soft text-ink" : "bg-surface text-ink",
                  )}
                >
                  {message.content}
                </div>
                {message.tools && message.tools.length > 0 ? (
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-meta text-ink-secondary">
                    <Wrench className="size-3" aria-hidden />
                    {message.tools.join(", ")}
                  </span>
                ) : null}
              </div>
            ))
          )}
          {running ? <p className="text-caption text-ink-secondary">{agentName} está escrevendo…</p> : null}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Mensagem do cliente"
            className="max-h-32 min-h-11 flex-1 resize-none"
          />
          <Button size="md" onClick={send} loading={running} disabled={!draft.trim()} className="h-11 shrink-0">
            <Send aria-hidden />
          </Button>
        </div>

        {messages.length > 0 ? (
          <button type="button" onClick={() => setMessages([])} className="self-start text-caption text-ink-secondary hover:text-ink">
            <Play className="mr-1 inline size-3" aria-hidden />
            Recomeçar conversa
          </button>
        ) : null}
      </div>
    </Card>
  );
}
