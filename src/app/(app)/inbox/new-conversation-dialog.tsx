"use client";

import { MessageSquarePlus, Search, Send } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  type CustomerSearchResult,
  searchCustomersForNewConversationAction,
  startConversationAction,
} from "./new-conversation-actions";

type Cliente = Extract<CustomerSearchResult, { ok: true }>["rows"][number];
type Porta = "cadastrada" | "numero";

/**
 * Começar uma conversa.
 *
 * O formulário fica num componente à parte, montado só enquanto o diálogo está
 * aberto: fechar destrói o estado junto, e nenhum rascunho de destinatário
 * reaparece na próxima abertura, para outra pessoa.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe a conversa aberta, para a tela poder selecioná-la. */
  onStarted?: (conversationId: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <Formulario onOpenChange={onOpenChange} onStarted={onStarted} /> : null}
    </Dialog>
  );
}

/**
 * Duas portas, porque são dois momentos diferentes da recepção: falar com
 * alguém que já é cliente (e cujo histórico não pode se partir num cadastro
 * novo) e falar com um número que acabou de chegar por indicação.
 *
 * A segunda porta exige o nome. Sem ele o cadastro nasce chamado
 * "(11) 98765-4321" — e é assim que a agenda, o financeiro e o próprio inbox
 * passam a chamar a pessoa pelo resto da vida.
 */
function Formulario({
  onOpenChange,
  onStarted,
}: {
  onOpenChange: (open: boolean) => void;
  onStarted?: (conversationId: number) => void;
}) {
  const [porta, setPorta] = useState<Porta>("cadastrada");
  const [busca, setBusca] = useState("");
  /** Última resposta do servidor, com o termo que a produziu. */
  const [resposta, setResposta] = useState<{ termo: string; rows: Cliente[] } | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  const termo = busca.trim();
  // Enquanto a resposta não corresponder ao que está digitado, a lista na tela
  // é a da busca anterior. Dizer isso evita o pior dos dois mundos: esvaziar a
  // lista a cada tecla, ou anunciar "nenhuma cliente" para quem existe.
  const buscando = Boolean(termo) && resposta?.termo !== termo;
  const resultados = termo ? (resposta?.rows ?? []) : [];

  /**
   * Busca sempre no SERVIDOR, com espera de 180 ms.
   *
   * Filtrar no navegador uma lista pré-carregada só funciona enquanto a clínica
   * é pequena: na centésima cliente, a que a atendente procura não está na
   * página, e a tela responde "nenhuma encontrada" para alguém que existe.
   *
   * `ativo` descarta a resposta de uma busca antiga que chegue depois da nova —
   * senão a lista de "ma" pisca por cima da lista de "mariana".
   */
  useEffect(() => {
    if (porta !== "cadastrada" || cliente || !termo) return;
    let ativo = true;
    const timer = setTimeout(async () => {
      const resultado = await searchCustomersForNewConversationAction(termo);
      if (!ativo) return;
      if (resultado.ok) setResposta({ termo, rows: resultado.rows });
      else {
        setResposta({ termo, rows: [] });
        setErro(resultado.error);
      }
    }, 180);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [termo, porta, cliente]);

  const digitos = telefone.replace(/\D/g, "");
  const destinatarioPronto =
    porta === "cadastrada" ? Boolean(cliente) : digitos.length >= 10 && Boolean(nome.trim());
  const pronto = destinatarioPronto && Boolean(texto.trim());

  function enviar() {
    if (!pronto) return;
    setErro(null);
    startTransition(async () => {
      const resultado = await startConversationAction(
        porta === "cadastrada"
          ? { customerId: cliente!.id, body: texto }
          : { phone: telefone, name: nome, body: texto },
      );
      if (!resultado.ok) {
        setErro(resultado.error);
        toast.error(resultado.error);
        return;
      }
      toast.success(
        resultado.reused
          ? "Mensagem enviada na conversa que já existia."
          : "Conversa aberta e mensagem enviada.",
      );
      onStarted?.(resultado.conversationId);
      onOpenChange(false);
    });
  }

  return (
    <DialogContent
      title="Nova conversa"
      description="A mensagem sai pelo WhatsApp da clínica e a conversa fica com você."
      className="max-w-[480px]"
    >
      <div className="space-y-4 px-5 py-4">
        <div className="flex gap-1.5">
          {(
            [
              ["cadastrada", "Cliente cadastrada"],
              ["numero", "Outro número"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={porta === valor}
              onClick={() => {
                setPorta(valor);
                setErro(null);
              }}
              className={cn(
                "h-9 flex-1 rounded-control border text-label transition-colors duration-[120ms]",
                porta === valor
                  ? "border-accent bg-accent text-white"
                  : "border-line-strong bg-surface-raised text-ink hover:border-ink-tertiary",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {porta === "cadastrada" ? (
          <div>
            <span className="mb-1.5 block text-label text-ink">Para quem</span>
            {cliente ? (
              <div className="flex items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2">
                <Avatar name={cliente.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-ink">{cliente.name}</span>
                  {cliente.phone ? (
                    <span className="block text-caption text-ink-secondary">
                      {formatPhone(cliente.phone)}
                    </span>
                  ) : (
                    <span className="block text-caption text-attention">Sem telefone na ficha</span>
                  )}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setCliente(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary" />
                  <Input
                    autoFocus
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por nome ou telefone"
                    className="pl-8"
                    aria-label="Buscar cliente"
                  />
                </div>
                {resultados.length > 0 ? (
                  <ul className="mt-1.5 max-h-[188px] divide-y divide-line overflow-y-auto rounded-control border border-line">
                    {resultados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setCliente(c);
                            setErro(null);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                        >
                          <Avatar name={c.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label text-ink">{c.name}</span>
                            <span className="block text-caption text-ink-secondary">
                              {c.phone ? formatPhone(c.phone) : "Sem telefone na ficha"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : termo && !buscando ? (
                  <p className="mt-2 text-caption text-ink-secondary">
                    Nenhuma cliente com esse nome ou telefone. Use “Outro número” para falar com
                    quem ainda não está no cadastro.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Field
              label="Número"
              htmlFor="conversa-telefone"
              hint={
                digitos.length >= 10
                  ? `Vai para ${formatPhone(digitos)}`
                  : "Com DDD, por exemplo (11) 98765-4321."
              }
            >
              <Input
                id="conversa-telefone"
                autoFocus
                type="tel"
                inputMode="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 98765-4321"
              />
            </Field>
            <Field
              label="Nome da cliente"
              htmlFor="conversa-nome"
              hint="Fica no cadastro dela. Sem nome, a ficha nasce com o número no lugar."
            >
              <Input
                id="conversa-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Como ela quer ser chamada"
              />
            </Field>
          </div>
        )}

        <Field label="Mensagem" htmlFor="conversa-mensagem">
          <Textarea
            id="conversa-mensagem"
            rows={4}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Oi! Aqui é da clínica…"
            maxLength={4000}
          />
        </Field>

        {erro ? (
          <p role="alert" className="text-caption text-danger">
            {erro}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button variant="primary" size="md" disabled={!pronto} loading={enviando} onClick={enviar}>
          <Send />
          Enviar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * O botão com o diálogo já ligado — é o que a tela do inbox precisa colocar na
 * barra de cima, sem administrar estado de abertura.
 */
export function NewConversationButton({
  onStarted,
  className,
  disabled,
  disabledTitle = "Conecte o WhatsApp para iniciar conversas",
}: {
  onStarted?: (conversationId: number) => void;
  className?: string;
  /** Sem WhatsApp conectado não há como enviar; melhor barrar antes do diálogo. */
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className={className}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        onClick={() => setAberto(true)}
      >
        <MessageSquarePlus />
        Nova conversa
      </Button>
      <NewConversationDialog open={aberto} onOpenChange={setAberto} onStarted={onStarted} />
    </>
  );
}
