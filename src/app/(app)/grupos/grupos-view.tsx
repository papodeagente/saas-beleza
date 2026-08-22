"use client";

import {
  Check,
  Copy,
  Crown,
  Link2,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { copyToClipboard } from "@/lib/clipboard";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  createGroupAction,
  getGroupAction,
  joinGroupAction,
  leaveGroupAction,
  listGroupsAction,
  resetInviteAction,
  updateGroupAction,
  updateParticipantsAction,
} from "./actions";

type Participant = {
  jid: string;
  phone: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

type Group = {
  jid: string;
  name: string;
  description: string | null;
  ownerPhone: string | null;
  participants: Participant[];
  participantCount: number;
  onlyAdminsSend: boolean;
  onlyAdminsEdit: boolean;
  requiresApproval: boolean;
  createdAt: string | null;
  inviteLink?: string | null;
};

const PAGE_SIZE = 30;

export function GruposView({ connected, canManage }: { connected: boolean; canManage: boolean }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  // Já nasce carregando só quando há de fato o que carregar.
  const [loading, setLoading] = useState(connected);
  const [selected, setSelected] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const buscaRef = useRef(0);

  const carregar = useCallback(async (termo: string, novoOffset: number) => {
    const chamada = ++buscaRef.current;
    setLoading(true);
    const result = await listGroupsAction({ search: termo || undefined, offset: novoOffset, limit: PAGE_SIZE });
    // Descarta resposta de uma busca que já foi substituída por outra.
    if (chamada !== buscaRef.current) return;
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setGroups(result.data.groups);
    setTotal(result.data.total);
    setOffset(result.data.offset);
  }, []);

  /**
   * Carrega no primeiro render e a cada busca, sempre depois de uma pausa na
   * digitação — cada consulta vai até o WhatsApp. O atraso também mantém a
   * mudança de estado fora do fluxo síncrono do efeito, que é o que dispara
   * renderizações em cascata.
   */
  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => void carregar(search, 0), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [search, connected, carregar]);

  async function abrir(jid: string) {
    const parcial = groups.find((g) => g.jid === jid);
    if (parcial) setSelected(parcial);
    const result = await getGroupAction(jid);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSelected(result.data);
  }

  if (!connected) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-4 py-10">
        <EmptyState
          icon={Users}
          title="Conecte o WhatsApp para ver seus grupos"
          description="A lista de grupos vem direto do aparelho conectado. Nada é copiado para cá, então o que você vê é sempre o estado real."
          action={
            <Button variant="secondary" size="md" asChild>
              <Link href="/whatsapp">Ir para a conexão</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const paginaAtual = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-[980px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title text-ink">Grupos</h1>
          <p className="mt-1 text-body text-ink-secondary">
            {total > 0 ? `${total} grupos no aparelho conectado.` : "Grupos do aparelho conectado."} As mudanças valem no
            WhatsApp na hora.
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={() => setJoining(true)}>
              <Link2 aria-hidden />
              Entrar por convite
            </Button>
            <Button size="md" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              Novo grupo
            </Button>
          </div>
        ) : null}
      </header>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-tertiary" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar grupo pelo nome"
          className="pl-9"
        />
      </div>

      {loading ? (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-[68px] animate-pulse rounded-card bg-surface-sunken" />
          ))}
        </ul>
      ) : groups.length === 0 ? (
        <p className="rounded-control bg-surface-sunken px-3 py-8 text-center text-caption text-ink-secondary">
          {search ? `Nenhum grupo encontrado para ${search}.` : "Nenhum grupo neste aparelho."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <li key={group.jid}>
              <button
                type="button"
                onClick={() => abrir(group.jid)}
                className="flex w-full items-center gap-3 rounded-card border border-line bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Users className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-ink">{group.name}</span>
                  <span className="block truncate text-caption text-ink-secondary">
                    {group.description || "Sem descrição"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {group.onlyAdminsSend ? <Badge tone="attention">Só admin</Badge> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {totalPaginas > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => carregar(search, Math.max(0, offset - PAGE_SIZE))}
          >
            Anterior
          </Button>
          <span className="text-caption text-ink-secondary tabular">
            {paginaAtual} de {totalPaginas}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => carregar(search, offset + PAGE_SIZE)}
          >
            Próxima
          </Button>
        </div>
      ) : null}

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent title={selected?.name ?? "Grupo"} className="w-full sm:max-w-[520px]">
          {selected ? (
            <GroupDetail
              group={selected}
              canManage={canManage}
              onChange={(next) => {
                setSelected(next);
                setGroups((prev) => prev.map((g) => (g.jid === next.jid ? { ...g, ...next } : g)));
              }}
              onLeave={() => {
                setGroups((prev) => prev.filter((g) => g.jid !== selected.jid));
                setSelected(null);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent title="Novo grupo" className="w-full sm:max-w-[480px]">
          <CreateGroup
            onCreated={(group) => {
              setCreating(false);
              setGroups((prev) => [group, ...prev]);
              setSelected(group);
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={joining} onOpenChange={setJoining}>
        <SheetContent title="Entrar por convite" className="w-full sm:max-w-[480px]">
          <JoinGroup
            onJoined={(group) => {
              setJoining(false);
              setGroups((prev) => [group, ...prev]);
              setSelected(group);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function GroupDetail({
  group,
  canManage,
  onChange,
  onLeave,
}: {
  group: Group;
  canManage: boolean;
  onChange: (next: Group) => void;
  onLeave: () => void;
}) {
  const [aba, setAba] = useState<"participantes" | "ajustes">("participantes");
  const [novoParticipante, setNovoParticipante] = useState("");
  const [busy, startBusy] = useTransition();
  const [copiado, setCopiado] = useState(false);

  function agir(promessa: Promise<{ ok: true; data: Group } | { ok: false; error: string }>, sucesso: string) {
    startBusy(async () => {
      const result = await promessa;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(result.data);
      toast.success(sucesso);
    });
  }

  const admins = group.participants.filter((p) => p.isAdmin || p.isSuperAdmin);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line pb-3">
        <p className="text-caption text-ink-secondary">
          {group.participantCount} {group.participantCount === 1 ? "participante" : "participantes"} ·{" "}
          {admins.length} {admins.length === 1 ? "administrador" : "administradores"}
        </p>
        <div className="mt-3 flex gap-1">
          {(["participantes", "ajustes"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              className={cn(
                "rounded-control px-3 py-1.5 text-label font-medium transition-colors",
                aba === id ? "bg-accent-soft text-accent" : "text-ink-secondary hover:bg-surface-sunken",
              )}
            >
              {id === "participantes" ? "Participantes" : "Ajustes"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pt-4">
        {aba === "participantes" ? (
          <div className="flex flex-col gap-3">
            {canManage ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Adicionar pelo telefone" hint="Com país e DDD, por exemplo 5511999998888.">
                    <Input
                      value={novoParticipante}
                      onChange={(e) => setNovoParticipante(e.target.value)}
                      placeholder="5511999998888"
                      inputMode="numeric"
                    />
                  </Field>
                </div>
                <Button
                  size="md"
                  loading={busy}
                  disabled={novoParticipante.replace(/\D/g, "").length < 12}
                  onClick={() => {
                    agir(
                      updateParticipantsAction({
                        groupJid: group.jid,
                        action: "add",
                        participants: [novoParticipante.replace(/\D/g, "")],
                      }) as never,
                      "Convite enviado",
                    );
                    setNovoParticipante("");
                  }}
                >
                  <UserPlus aria-hidden />
                </Button>
              </div>
            ) : null}

            <ul className="flex flex-col divide-y divide-line">
              {group.participants.length === 0 ? (
                <li className="py-6 text-center text-caption text-ink-secondary">
                  A lista de participantes não veio nesta consulta.
                </li>
              ) : null}
              {group.participants.map((p) => (
                <li key={p.jid} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-ink">
                      {p.displayName || (p.phone ? formatPhone(p.phone) : "Participante")}
                    </span>
                    {p.displayName && p.phone ? (
                      <span className="block truncate text-caption text-ink-secondary tabular">
                        {formatPhone(p.phone)}
                      </span>
                    ) : null}
                  </span>
                  {p.isSuperAdmin ? (
                    <Badge tone="accent">
                      <Crown className="size-3" aria-hidden />
                      Dono
                    </Badge>
                  ) : p.isAdmin ? (
                    <Badge tone="info">
                      <ShieldCheck className="size-3" aria-hidden />
                      Admin
                    </Badge>
                  ) : null}
                  {canManage && !p.isSuperAdmin ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title={p.isAdmin ? "Rebaixar" : "Tornar administrador"}
                        loading={busy}
                        onClick={() =>
                          agir(
                            updateParticipantsAction({
                              groupJid: group.jid,
                              action: p.isAdmin ? "demote" : "promote",
                              participants: [p.jid],
                            }) as never,
                            p.isAdmin ? "Não é mais administrador" : "Agora é administrador",
                          )
                        }
                      >
                        <ShieldCheck aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Remover do grupo"
                        loading={busy}
                        onClick={() => {
                          if (!confirm(`Remover ${p.displayName || p.phone} do grupo?`)) return;
                          agir(
                            updateParticipantsAction({
                              groupJid: group.jid,
                              action: "remove",
                              participants: [p.jid],
                            }) as never,
                            "Participante removido",
                          );
                        }}
                      >
                        <UserMinus aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Nome do grupo">
              <Input
                defaultValue={group.name}
                disabled={!canManage}
                onBlur={(e) => {
                  const valor = e.target.value.trim();
                  if (!valor || valor === group.name) return;
                  agir(updateGroupAction({ groupJid: group.jid, name: valor }) as never, "Nome atualizado");
                }}
              />
            </Field>

            <Field label="Descrição">
              <Textarea
                defaultValue={group.description ?? ""}
                rows={4}
                disabled={!canManage}
                onBlur={(e) => {
                  const valor = e.target.value.trim();
                  if (valor === (group.description ?? "")) return;
                  agir(updateGroupAction({ groupJid: group.jid, description: valor }) as never, "Descrição atualizada");
                }}
              />
            </Field>

            <div className="flex flex-col gap-1 border-t border-line pt-3">
              <GroupToggle
                label="Só administradores enviam mensagem"
                hint="Use para avisos, quando o grupo não é para conversa."
                checked={group.onlyAdminsSend}
                disabled={!canManage || busy}
                onChange={(v) =>
                  agir(updateGroupAction({ groupJid: group.jid, onlyAdminsSend: v }) as never, "Permissão atualizada")
                }
              />
              <GroupToggle
                label="Só administradores editam o grupo"
                hint="Nome, foto e descrição ficam travados para os demais."
                checked={group.onlyAdminsEdit}
                disabled={!canManage || busy}
                onChange={(v) =>
                  agir(updateGroupAction({ groupJid: group.jid, onlyAdminsEdit: v }) as never, "Permissão atualizada")
                }
              />
              <GroupToggle
                label="Aprovar quem entra pelo link"
                hint="Cada pedido precisa de aprovação de um administrador."
                checked={group.requiresApproval}
                disabled={!canManage || busy}
                onChange={(v) =>
                  agir(updateGroupAction({ groupJid: group.jid, requiresApproval: v }) as never, "Permissão atualizada")
                }
              />
            </div>

            <div className="border-t border-line pt-3">
              <p className="text-label text-ink">Link de convite</p>
              {group.inviteLink ? (
                <div className="mt-1.5 flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-2">
                  <input
                    readOnly
                    value={group.inviteLink}
                    aria-label="Link de convite do grupo"
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 truncate bg-transparent text-caption text-ink outline-none"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const ok = await copyToClipboard(group.inviteLink ?? "");
                      if (ok) {
                        setCopiado(true);
                        setTimeout(() => setCopiado(false), 1600);
                        toast.success("Link copiado");
                      } else {
                        toast.error("Não consegui copiar. Selecione o link e copie manualmente.");
                      }
                    }}
                  >
                    {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-caption text-ink-secondary">
                  Este grupo não expôs link de convite. Normalmente é falta de permissão de administrador.
                </p>
              )}
              {canManage ? (
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1.5 text-caption text-ink-secondary hover:text-ink"
                  onClick={() => {
                    if (!confirm("Gerar um link novo? Quem tiver o link antigo perde o acesso.")) return;
                    startBusy(async () => {
                      const result = await resetInviteAction(group.jid);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      onChange({ ...group, inviteLink: result.data });
                      toast.success("Link renovado");
                    });
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Gerar link novo
                </button>
              ) : null}
            </div>

            {canManage ? (
              <div className="border-t border-line pt-3">
                <Button
                  variant="ghost"
                  size="md"
                  className="text-danger"
                  loading={busy}
                  onClick={() => {
                    if (!confirm(`Sair de "${group.name}"? Para voltar será preciso um novo convite.`)) return;
                    startBusy(async () => {
                      const result = await leaveGroupAction(group.jid);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      toast.success("Você saiu do grupo");
                      onLeave();
                    });
                  }}
                >
                  <LogOut aria-hidden />
                  Sair do grupo
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cn("flex items-start justify-between gap-3 py-2", disabled ? "opacity-60" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className="block text-label text-ink">{label}</span>
        <span className="block text-caption text-ink-secondary">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
      />
    </label>
  );
}

function CreateGroup({ onCreated }: { onCreated: (group: Group) => void }) {
  const [name, setName] = useState("");
  const [numeros, setNumeros] = useState("");
  const [busy, startBusy] = useTransition();

  const lista = numeros
    .split(/[\n,;]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 12);

  return (
    <div className="flex h-full flex-col">
      <p className="pb-3 text-caption text-ink-secondary">
        O grupo é criado no aparelho conectado, com ele como administrador.
      </p>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        <Field label="Nome do grupo">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Clientes VIP" />
        </Field>
        <Field
          label="Participantes"
          hint="Um número por linha, com país e DDD. O WhatsApp exige pelo menos um para criar."
        >
          <Textarea
            value={numeros}
            onChange={(e) => setNumeros(e.target.value)}
            rows={6}
            placeholder={"5511999998888\n5511988887777"}
          />
        </Field>
        <p className="text-caption text-ink-secondary">
          {lista.length} {lista.length === 1 ? "número válido" : "números válidos"}
        </p>
        <Button
          size="md"
          loading={busy}
          disabled={!name.trim() || lista.length === 0}
          onClick={() =>
            startBusy(async () => {
              const result = await createGroupAction({ name: name.trim(), participants: lista });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Grupo criado");
              onCreated(result.data);
            })
          }
        >
          Criar grupo
        </Button>
        <p className="flex items-start gap-1.5 text-caption text-ink-secondary">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Quem tem privacidade restrita não entra direto: recebe convite e decide.
        </p>
      </div>
    </div>
  );
}

function JoinGroup({ onJoined }: { onJoined: (group: Group) => void }) {
  const [codigo, setCodigo] = useState("");
  const [busy, startBusy] = useTransition();

  return (
    <div className="flex h-full flex-col">
      <p className="pb-3 text-caption text-ink-secondary">Cole o link ou o código do convite.</p>
      <div className="flex flex-1 flex-col gap-3">
        <Field label="Link ou código">
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="https://chat.whatsapp.com/…"
          />
        </Field>
        <Button
          size="md"
          loading={busy}
          disabled={codigo.trim().length < 4}
          onClick={() =>
            startBusy(async () => {
              const result = await joinGroupAction(codigo.trim());
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Você entrou no grupo");
              onJoined(result.data);
            })
          }
        >
          Entrar
        </Button>
      </div>
    </div>
  );
}
