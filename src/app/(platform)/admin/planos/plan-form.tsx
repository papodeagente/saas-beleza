"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatBRL, parseBRL } from "@/lib/money";
import { annualDeal, formatMonths, formatPercent } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { deletePlanAction, savePlanAction, setPlanActiveAction } from "./actions";

/** O que a página passa para cá — valores como estão no banco (dinheiro em centavos). */
export type PlanRecord = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  trialDays: number;
  maxBranches: number | null;
  maxProfessionals: number | null;
  maxUsers: number | null;
  position: number;
  active: boolean;
  publicVisible: boolean;
  tagline: string | null;
  benefits: string[];
  ctaLabel: string | null;
  checkoutUrlMonthly: string | null;
  checkoutUrlYearly: string | null;
  highlight: boolean;
  highlightLabel: string | null;
};

type FormValues = {
  name: string;
  slug: string;
  description: string;
  monthlyPrice: string;
  yearlyPrice: string;
  trialDays: string;
  maxBranches: string;
  maxProfessionals: string;
  maxUsers: string;
  position: string;
  publicVisible: boolean;
  tagline: string;
  benefits: string[];
  ctaLabel: string;
  checkoutUrlMonthly: string;
  checkoutUrlYearly: string;
  highlight: boolean;
  highlightLabel: string;
};

const reais = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EMPTY: FormValues = {
  name: "",
  slug: "",
  description: "",
  monthlyPrice: "",
  yearlyPrice: "",
  trialDays: "14",
  maxBranches: "",
  maxProfessionals: "",
  maxUsers: "",
  position: "0",
  publicVisible: false,
  tagline: "",
  benefits: [],
  ctaLabel: "",
  checkoutUrlMonthly: "",
  checkoutUrlYearly: "",
  highlight: false,
  highlightLabel: "",
};

function toForm(plan: PlanRecord): FormValues {
  return {
    name: plan.name,
    slug: plan.slug,
    description: plan.description ?? "",
    monthlyPrice: reais(plan.monthlyPriceCents),
    yearlyPrice: reais(plan.yearlyPriceCents),
    trialDays: String(plan.trialDays),
    maxBranches: plan.maxBranches === null ? "" : String(plan.maxBranches),
    maxProfessionals: plan.maxProfessionals === null ? "" : String(plan.maxProfessionals),
    maxUsers: plan.maxUsers === null ? "" : String(plan.maxUsers),
    position: String(plan.position),
    publicVisible: plan.publicVisible,
    tagline: plan.tagline ?? "",
    benefits: plan.benefits,
    ctaLabel: plan.ctaLabel ?? "",
    checkoutUrlMonthly: plan.checkoutUrlMonthly ?? "",
    checkoutUrlYearly: plan.checkoutUrlYearly ?? "",
    highlight: plan.highlight,
    highlightLabel: plan.highlightLabel ?? "",
  };
}

/** Sugere o identificador enquanto o nome é digitado — só na criação. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function PlanForm({ plan, onClose }: { plan?: PlanRecord; onClose: () => void }) {
  const router = useRouter();
  const editing = Boolean(plan);
  const [values, setValues] = useState<FormValues>(plan ? toForm(plan) : EMPTY);
  const [slugTouched, setSlugTouched] = useState(editing);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * O que está digitado no campo "escreva um benefício" ainda não virou linha da
   * lista, e quem escreve o último benefício e vai direto no Salvar não tem por
   * que saber disso. Sem este espelho o texto sumia e a tela ainda dizia "Plano
   * atualizado" — perda silenciosa com aviso de sucesso, que é o pior dos dois
   * mundos. Fica em ref porque precisa estar atual no clique do rodapé, sem
   * depender da ordem em que o React esvazia o estado entre dois eventos.
   */
  const benefitDraft = useRef("");

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const monthlyCents = parseBRL(values.monthlyPrice);
  const yearlyCents = parseBRL(values.yearlyPrice);

  function submit() {
    setError(null);
    const pendentes = splitPasted(benefitDraft.current);
    const payload: FormValues = pendentes.length
      ? { ...values, benefits: [...values.benefits, ...pendentes] }
      : values;
    startTransition(async () => {
      const result = await savePlanAction(payload, plan?.id);
      if (result.ok) {
        toast.success(editing ? "Plano atualizado" : `Plano ${values.name.trim()} criado`);
        router.refresh();
        onClose();
      } else {
        setError({ message: result.error, field: result.field });
      }
    });
  }

  const fieldError = (name: keyof FormValues) => (error?.field === name ? error.message : undefined);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={editing ? `Editar ${plan!.name}` : "Novo plano"}
        description={
          editing
            ? "Vale para novas contratações — quem já assina mantém o preço travado."
            : "O plano nasce ativo e já pode ser vendido."
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={pending}
              disabled={values.name.trim().length < 2}
              onClick={submit}
            >
              {editing ? "Salvar alterações" : "Criar plano"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">
          <Field label="Nome" htmlFor="p-nome" error={fieldError("name")}>
            <Input
              id="p-nome"
              autoFocus
              value={values.name}
              onChange={(e) => {
                set("name", e.target.value);
                if (!slugTouched) set("slug", slugify(e.target.value));
              }}
              placeholder="Profissional"
              aria-invalid={fieldError("name") ? true : undefined}
              aria-describedby={fieldError("name") ? "p-nome-desc" : undefined}
            />
          </Field>

          <Field
            label="Identificador"
            htmlFor="p-slug"
            error={fieldError("slug")}
            hint={
              editing
                ? "Não muda depois de criado: as assinaturas apontam para ele e trocar quebraria a leitura do histórico."
                : "Letras minúsculas, números e hífen. Escolha com calma: depois de criado não muda."
            }
          >
            <Input
              id="p-slug"
              value={values.slug}
              disabled={editing}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value);
              }}
              placeholder="profissional"
              aria-invalid={fieldError("slug") ? true : undefined}
              aria-describedby="p-slug-desc"
            />
          </Field>

          <Field label="Descrição" htmlFor="p-desc" optional hint="A frase que resume o plano na proposta.">
            <Textarea
              id="p-desc"
              rows={2}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Inclui WhatsApp, agendamento online e relatórios."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preço mensal" htmlFor="p-mensal" error={fieldError("monthlyPrice")} hint="Em reais.">
              <Input
                id="p-mensal"
                inputMode="decimal"
                value={values.monthlyPrice}
                onChange={(e) => set("monthlyPrice", e.target.value)}
                placeholder="299,00"
                className="tabular"
                aria-invalid={fieldError("monthlyPrice") ? true : undefined}
                aria-describedby="p-mensal-desc"
              />
            </Field>

            <Field
              label="Preço anual"
              htmlFor="p-anual"
              error={fieldError("yearlyPrice")}
              hint="O ano inteiro, não o mês."
            >
              <Input
                id="p-anual"
                inputMode="decimal"
                value={values.yearlyPrice}
                onChange={(e) => set("yearlyPrice", e.target.value)}
                placeholder="2.990,00"
                className="tabular"
                aria-invalid={fieldError("yearlyPrice") ? true : undefined}
                aria-describedby="p-anual-desc"
              />
            </Field>
          </div>

          <AnnualPreview monthlyCents={monthlyCents} yearlyCents={yearlyCents} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dias de teste" htmlFor="p-teste" error={fieldError("trialDays")} hint="0 para vender sem teste.">
              <Input
                id="p-teste"
                inputMode="numeric"
                value={values.trialDays}
                onChange={(e) => set("trialDays", e.target.value)}
                className="tabular"
                aria-invalid={fieldError("trialDays") ? true : undefined}
                aria-describedby="p-teste-desc"
              />
            </Field>

            <Field label="Ordem na lista" htmlFor="p-ordem" error={fieldError("position")} hint="Menor aparece primeiro.">
              <Input
                id="p-ordem"
                inputMode="numeric"
                value={values.position}
                onChange={(e) => set("position", e.target.value)}
                className="tabular"
                aria-invalid={fieldError("position") ? true : undefined}
                aria-describedby="p-ordem-desc"
              />
            </Field>
          </div>

          <div>
            <p className="text-section">Limites</p>
            <p className="mt-0.5 text-caption text-ink-tertiary">
              Em branco significa ilimitado.
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-3">
              <Field label="Unidades" htmlFor="p-unidades" error={fieldError("maxBranches")}>
                <Input
                  id="p-unidades"
                  inputMode="numeric"
                  value={values.maxBranches}
                  onChange={(e) => set("maxBranches", e.target.value)}
                  placeholder="∞"
                  className="tabular"
                  aria-invalid={fieldError("maxBranches") ? true : undefined}
                />
              </Field>
              <Field label="Profissionais" htmlFor="p-profs" error={fieldError("maxProfessionals")}>
                <Input
                  id="p-profs"
                  inputMode="numeric"
                  value={values.maxProfessionals}
                  onChange={(e) => set("maxProfessionals", e.target.value)}
                  placeholder="∞"
                  className="tabular"
                  aria-invalid={fieldError("maxProfessionals") ? true : undefined}
                />
              </Field>
              <Field label="Usuários" htmlFor="p-users" error={fieldError("maxUsers")}>
                <Input
                  id="p-users"
                  inputMode="numeric"
                  value={values.maxUsers}
                  onChange={(e) => set("maxUsers", e.target.value)}
                  placeholder="∞"
                  className="tabular"
                  aria-invalid={fieldError("maxUsers") ? true : undefined}
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <p className="text-section">Vitrine</p>
            <p className="mt-0.5 text-caption text-ink-tertiary">
              O que a página de preços do site mostra deste plano.
            </p>

            <div className="mt-2.5 space-y-4">
              <Caixa
                label="Aparece no site"
                hint="Desmarcado, o plano continua vendável pelo painel e some da página de preços."
                checked={values.publicVisible}
                onChange={(checked) => set("publicVisible", checked)}
              />

              {values.publicVisible && editing && !plan!.active ? (
                <p className="rounded-card bg-attention-soft px-3 py-2.5 text-caption text-attention">
                  Este plano está fora de venda. Marcado ou não, ele só volta à página de preços
                  depois de ser ativado.
                </p>
              ) : null}

              <Field
                label="Chamada curta"
                htmlFor="p-tagline"
                optional
                error={fieldError("tagline")}
                hint="A linha embaixo do nome do plano, no cartão de preço."
              >
                <Input
                  id="p-tagline"
                  value={values.tagline}
                  onChange={(e) => set("tagline", e.target.value)}
                  placeholder="A clínica inteira por um preço só"
                  aria-invalid={fieldError("tagline") ? true : undefined}
                  aria-describedby="p-tagline-desc"
                />
              </Field>

              <BenefitsField
                initial={values.benefits}
                onChange={(next) => set("benefits", next)}
                onDraftChange={(text) => {
                  benefitDraft.current = text;
                }}
                error={fieldError("benefits")}
              />

              <Field
                label="Rótulo do botão"
                htmlFor="p-cta"
                optional
                error={fieldError("ctaLabel")}
                hint="Em branco, o site escolhe sozinho conforme o plano tenha checkout ou teste grátis."
              >
                <Input
                  id="p-cta"
                  value={values.ctaLabel}
                  onChange={(e) => set("ctaLabel", e.target.value)}
                  placeholder="Assinar agora"
                  aria-invalid={fieldError("ctaLabel") ? true : undefined}
                  aria-describedby="p-cta-desc"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Checkout mensal"
                  htmlFor="p-checkout-mensal"
                  optional
                  error={fieldError("checkoutUrlMonthly")}
                  hint="Só https://. Em branco, o botão leva ao teste grátis."
                >
                  <Input
                    id="p-checkout-mensal"
                    type="url"
                    inputMode="url"
                    value={values.checkoutUrlMonthly}
                    onChange={(e) => set("checkoutUrlMonthly", e.target.value)}
                    placeholder="https://pay.hotmart.com/..."
                    aria-invalid={fieldError("checkoutUrlMonthly") ? true : undefined}
                    aria-describedby="p-checkout-mensal-desc"
                  />
                </Field>

                <Field
                  label="Checkout anual"
                  htmlFor="p-checkout-anual"
                  optional
                  error={fieldError("checkoutUrlYearly")}
                  hint="A oferta anual tem link próprio no provedor."
                >
                  <Input
                    id="p-checkout-anual"
                    type="url"
                    inputMode="url"
                    value={values.checkoutUrlYearly}
                    onChange={(e) => set("checkoutUrlYearly", e.target.value)}
                    placeholder="https://pay.hotmart.com/..."
                    aria-invalid={fieldError("checkoutUrlYearly") ? true : undefined}
                    aria-describedby="p-checkout-anual-desc"
                  />
                </Field>
              </div>

              <Caixa
                label="Destacar este plano"
                hint="Só um plano deveria ficar destacado — dois destaques não destacam nada."
                checked={values.highlight}
                onChange={(checked) => set("highlight", checked)}
              />

              {values.highlight ? (
                <Field
                  label="Selo do destaque"
                  htmlFor="p-selo"
                  optional
                  error={fieldError("highlightLabel")}
                  hint="O texto da faixa em cima do cartão."
                >
                  <Input
                    id="p-selo"
                    value={values.highlightLabel}
                    onChange={(e) => set("highlightLabel", e.target.value)}
                    placeholder="Mais escolhido"
                    aria-invalid={fieldError("highlightLabel") ? true : undefined}
                    aria-describedby="p-selo-desc"
                  />
                </Field>
              ) : null}
            </div>
          </div>

          {error && !error.field ? (
            <p role="alert" className="text-caption text-danger">
              {error.message}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Caixa de marcar com o rótulo clicável — o alvo é a linha inteira, não o quadradinho. */
function Caixa({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-card border border-line bg-surface px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-label text-ink">{label}</span>
        <span className="mt-0.5 block text-caption text-ink-secondary">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Lista de benefícios do cartão de preço.
 *
 * ESCOLHA: lista de linhas com botões, e NÃO um textarea nem arrastar-e-soltar.
 *
 * O textarea foi considerado a sério — é menos código e aceita colar dez linhas
 * de uma vez. Perdeu por um motivo só: ele não tem estado errado visível. Uma
 * linha em branco no meio, um espaço duplo, um item colado grudado no anterior —
 * tudo isso passa despercebido na edição e só aparece no site. Aqui cada
 * benefício é uma linha numerada: dá para contar quantos são olhando, e um item
 * vazio salta aos olhos. O que o textarea tinha de bom foi trazido junto — colar
 * um bloco de texto no campo de adicionar vira uma linha por item, com marcador
 * de lista removido.
 *
 * Arrastar-e-soltar foi descartado: é o gesto que mais erra na prática (solta no
 * lugar errado, não funciona no toque, não existe para quem navega por teclado).
 * Subir e descer por botão faz a mesma coisa, é reversível e o foco acompanha o
 * item que se move — dá para clicar "subir" três vezes seguidas sem tirar a mão.
 */
type BenefitRow = { id: string; text: string };

let benefitSeq = 0;
const nextBenefitId = () => `b${++benefitSeq}`;

/** Marcador de lista colado junto do texto ("- ", "• ") não é conteúdo, é enfeite. */
const BULLET = /^\s*[-–—•*·]\s+/;

function splitPasted(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(BULLET, "").trim())
    .filter(Boolean);
}

function BenefitsField({
  initial,
  onChange,
  onDraftChange,
  error,
}: {
  initial: string[];
  onChange: (next: string[]) => void;
  /** Espelha o que ainda está por adicionar, para o salvamento não perder a linha. */
  onDraftChange: (text: string) => void;
  error?: string;
}) {
  // As linhas ganham id na montagem e o componente passa a ser dono delas. É o
  // id estável que faz o React MOVER o nó da lista em vez de reescrevê-lo — e é
  // por isso que o foco fica no botão "subir" depois de subir.
  const [rows, setRows] = useState<BenefitRow[]>(() =>
    initial.map((text) => ({ id: nextBenefitId(), text })),
  );
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLInputElement>(null);

  function commit(next: BenefitRow[]) {
    setRows(next);
    onChange(next.map((row) => row.text));
  }

  /** Estado e espelho andam juntos: um rascunho só existe se os dois souberem dele. */
  function setRascunho(text: string) {
    setDraft(text);
    onDraftChange(text);
  }

  function add(raw: string) {
    const items = splitPasted(raw);
    if (items.length === 0) return;
    commit([...rows, ...items.map((text) => ({ id: nextBenefitId(), text }))]);
    setRascunho("");
    draftRef.current?.focus();
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-baseline gap-1.5 text-label text-ink">
        Benefícios
        <span className="text-caption text-ink-tertiary">
          {rows.length === 0 ? "(nenhum)" : `(${rows.length})`}
        </span>
      </p>

      {rows.length > 0 ? (
        <ol className="space-y-1.5">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right tabular text-caption text-ink-tertiary">
                {index + 1}
              </span>
              <Input
                value={row.text}
                aria-label={`Benefício ${index + 1}`}
                // A folha é estreita e o benefício é longo: o texto corta na
                // tela. O title devolve a frase inteira sem clicar dentro.
                title={row.text}
                onChange={(e) =>
                  commit(rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))
                }
              />
              <div className="flex shrink-0 items-center">
                <IconeAcao
                  label={`Subir "${row.text || `benefício ${index + 1}`}"`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </IconeAcao>
                <IconeAcao
                  label={`Descer "${row.text || `benefício ${index + 1}`}"`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </IconeAcao>
                <IconeAcao
                  label={`Remover "${row.text || `benefício ${index + 1}`}"`}
                  onClick={() => commit(rows.filter((r) => r.id !== row.id))}
                  className="hover:text-danger"
                >
                  <X />
                </IconeAcao>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex items-center gap-1.5">
        <span className="w-4 shrink-0" aria-hidden />
        <Input
          ref={draftRef}
          value={draft}
          placeholder="Escreva um benefício e tecle Enter"
          aria-label="Novo benefício"
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // A folha não é um <form>, então hoje o Enter não dispara nada por
            // conta própria — o dia em que virar, ele salvaria o plano com o
            // benefício ainda por adicionar. Barrar a ação padrão custa uma
            // linha e não depende de ninguém lembrar disso depois.
            e.preventDefault();
            add(draft);
          }}
          onPaste={(e) => {
            const texto = e.clipboardData.getData("text");
            if (!texto.includes("\n")) return;
            e.preventDefault();
            add(texto);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 px-3"
          disabled={draft.trim() === ""}
          onClick={() => add(draft)}
        >
          <Plus />
          Adicionar
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : (
        <p className="text-caption text-ink-tertiary">
          Aparecem no cartão nesta ordem. Colar uma lista pronta cria uma linha por item.
        </p>
      )}
    </div>
  );
}

function IconeAcao({
  label,
  children,
  onClick,
  disabled,
  className,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-control text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Traduz os dois preços na hora: é aqui que se percebe um desconto digitado
 * errado.
 *
 * A conta vem de `@/lib/pricing`, o mesmo módulo que o site usa. Não é economia
 * de linhas: enquanto existiam duas contas, esta tela podia arredondar de um
 * jeito e a página de preço de outro, e o cliente veria um desconto na vitrine e
 * outro na fatura.
 */
function AnnualPreview({
  monthlyCents,
  yearlyCents,
}: {
  monthlyCents: number | null;
  yearlyCents: number | null;
}) {
  if (monthlyCents === null || yearlyCents === null || monthlyCents === 0) return null;

  const deal = annualDeal(monthlyCents, yearlyCents);
  const over = deal.savedCents < 0;

  return (
    <div
      className={cn(
        "rounded-card px-3 py-2.5",
        over ? "bg-attention-soft" : "bg-surface",
      )}
    >
      <p className={cn("text-caption", over ? "text-attention" : "text-ink-secondary")}>
        {over ? (
          <>
            No anual a conta paga {formatBRL(-deal.savedCents)} a MAIS por ano do que pagando mês a
            mês. Confira os valores.
          </>
        ) : deal.savedCents === 0 ? (
          <>
            O anual sai igual ao mensal: {formatBRL(deal.equivalentMonthlyCents)} por mês, sem
            desconto.
          </>
        ) : (
          <>
            No anual: {formatBRL(deal.equivalentMonthlyCents)} por mês —{" "}
            {formatPercent(deal.ratio)} de desconto, {formatMonths(deal.months)} de graça.
          </>
        )}
      </p>
      <p className="mt-1 text-meta text-ink-tertiary">
        Mudar preço aqui não altera quem já assinou.
      </p>
    </div>
  );
}

export function NewPlanButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus />
        Novo plano
      </Button>
      {open ? <PlanForm onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Ações de uma linha. Excluir só existe para plano que nunca foi vendido — o
 * servidor recusa de qualquer jeito, mas oferecer um botão que sempre falha
 * seria mentir para quem opera.
 */
export function PlanRowActions({
  plan,
  deletable,
}: {
  plan: PlanRecord;
  deletable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (
      plan.active &&
      !confirm(
        `Desativar "${plan.name}"? Ele para de aceitar novas assinaturas; quem já assina continua igual.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await setPlanActiveAction(plan.id, !plan.active);
      if (result.ok) {
        toast.success(plan.active ? `${plan.name} desativado` : `${plan.name} ativado`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function remove() {
    if (!confirm(`Excluir o plano "${plan.name}"? Não dá para desfazer.`)) return;
    startTransition(async () => {
      const result = await deletePlanAction(plan.id);
      if (result.ok) {
        toast.success(`${plan.name} excluído`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        Editar
      </Button>
      <Button variant="ghost" size="sm" loading={pending} onClick={toggle}>
        {plan.active ? "Desativar" : "Ativar"}
      </Button>
      {deletable ? (
        <Button
          variant="ghost"
          size="sm"
          className="px-2 text-ink-tertiary hover:text-danger"
          aria-label={`Excluir plano ${plan.name}`}
          onClick={remove}
        >
          <Trash2 />
        </Button>
      ) : null}
      {editing ? <PlanForm plan={plan} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
