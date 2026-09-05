"use client";

import { PackagePlus, Pencil, Scissors } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardList } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatBRL, parseBRL } from "@/lib/money";
import {
  contarFuturosAction,
  saveProductAction,
  saveServiceAction,
  setProductActiveAction,
  setServiceActiveAction,
  type CatalogResult,
} from "./actions";

type Option = { id: number; name: string };

export type ServiceRow = {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  costCents: number;
  commissionBps: number | null;
  onlineBooking: boolean;
  active: boolean;
  returnIntervalDays: number | null;
  requiredResourceType: string | null;
  categoryName: string | null;
  professionalIds: number[];
  professionalNames: string[];
};

export type ProductRow = {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  priceCents: number;
  costCents: number;
  stockQty: number;
  active: boolean;
  categoryName: string | null;
};

const RECURSO: Record<string, string> = {
  room: "precisa de sala",
  cabin: "precisa de cabine",
  equipment: "precisa de equipamento",
};

/**
 * "2.800" é dois mil e oitocentos, não dois e oitenta.
 *
 * A versão anterior fazia `Number(valor.replace(",", "."))`: o ponto de milhar
 * sobrevivia e "2.800" virava 2,80 — o preço do HIFU caía de R$ 2.500 para
 * R$ 2,80 sem erro nenhum, e ia assim para a agenda e para a página pública que
 * VENDE por esse valor. No cadastro isso nasce errado; na edição isso apaga um
 * preço certo, e não existe desfazer.
 *
 * `parseBRL` já existia em `@/lib/money`, já é usado pela agenda e pelos planos,
 * e devolve `null` em vez de `NaN`. O catálogo era o único lugar que
 * reimplementava — e reimplementava errado.
 */
const paraCentavos = (valor: string): number | null => parseBRL(valor);

/** Preço preenchido e válido. Zero É um preço: cortesia, brinde, avaliação. */
const precoValido = (valor: string) => parseBRL(valor) !== null;
/**
 * 3990 → "39,90".
 *
 * Sempre com as duas casas: `String(3990/100)` devolve "39.9", e um campo de
 * preço que abre escrito "39,9" faz a dona conferir duas vezes se não perdeu
 * um zero.
 */
/**
 * 3990 → "39,90", e 0 → "0,00".
 *
 * O zero precisava aparecer: antes ele virava campo vazio, o botão Salvar ficava
 * morto e um serviço de cortesia não podia mais ser editado — nem para deixar de
 * ser cortesia.
 */
const deCentavos = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");

type Aberto =
  | { tipo: "servico"; item: ServiceRow | null }
  | { tipo: "produto"; item: ProductRow | null }
  | null;

/**
 * A tela do catálogo, com a lista e os formulários no mesmo lugar.
 *
 * A lista virou cliente por um motivo só: a afordância de editar é a LINHA
 * INTEIRA, que é o padrão de interação do produto ("clicar numa entidade abre
 * contexto e ações sem tirar o usuário da tela", em sheet.tsx). Um lápis no fim
 * de cada linha resolveria com menos código e daria uma tela de configurações —
 * e um catálogo de salão é uma carta, não um painel de ajustes.
 */
export function CatalogForms({
  professionals,
  services,
  products,
  canSeeMargin,
  canManage,
}: {
  professionals: Option[];
  services: ServiceRow[];
  products: ProductRow[];
  canSeeMargin: boolean;
  canManage: boolean;
}) {
  const [aberto, setAberto] = useState<Aberto>(null);

  const porCategoria = services.reduce((mapa, servico) => {
    const chave = servico.categoryName ?? "Sem categoria";
    const lista = mapa.get(chave) ?? [];
    lista.push(servico);
    mapa.set(chave, lista);
    return mapa;
  }, new Map<string, ServiceRow[]>());

  return (
    <>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setAberto({ tipo: "servico", item: null })}>
            <Scissors />
            Novo serviço
          </Button>
          <Button variant="secondary" onClick={() => setAberto({ tipo: "produto", item: null })}>
            <PackagePlus />
            Novo produto
          </Button>
        </div>
      ) : null}

      {services.length ? (
        <section aria-labelledby="servicos-catalogo" className="mt-8">
          <p id="servicos-catalogo" className="text-section">
            Serviços
          </p>
          <div className="mt-2.5 space-y-6">
            {[...porCategoria.entries()].map(([categoria, lista]) => (
              <Card key={categoria}>
                {/* Categoria e cabeçalho de colunas na mesma linha: os números
                    da direita nunca aparecem sem dizer o que são. */}
                <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                  <h2 className="min-w-0 flex-[2] text-card text-ink">{categoria}</h2>
                  <span className="hidden w-16 shrink-0 text-section sm:block">Duração</span>
                  <span className="hidden w-24 shrink-0 text-right text-section sm:block">Preço</span>
                  {canSeeMargin ? (
                    <span className="hidden w-16 shrink-0 text-right text-section sm:block">Margem</span>
                  ) : null}
                </div>

                <CardList>
                  {lista.map((servico) => (
                    <li key={servico.id}>
                      <LinhaDeServico
                        servico={servico}
                        canSeeMargin={canSeeMargin}
                        onEditar={
                          canManage ? () => setAberto({ tipo: "servico", item: servico }) : undefined
                        }
                      />
                    </li>
                  ))}
                </CardList>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {products.length ? (
        <section aria-labelledby="produtos-catalogo" className="mt-8">
          <p id="produtos-catalogo" className="text-section">
            Produtos
          </p>
          <Card className="mt-2.5">
            <CardList>
              {products.map((produto) => (
                <li key={produto.id}>
                  <LinhaDeProduto
                    produto={produto}
                    canSeeMargin={canSeeMargin}
                    onEditar={
                      canManage ? () => setAberto({ tipo: "produto", item: produto }) : undefined
                    }
                  />
                </li>
              ))}
            </CardList>
          </Card>
        </section>
      ) : null}

      {aberto?.tipo === "servico" ? (
        <ServiceSheet
          professionals={professionals}
          servico={aberto.item}
          close={() => setAberto(null)}
        />
      ) : null}
      {aberto?.tipo === "produto" ? (
        <ProductSheet produto={aberto.item} close={() => setAberto(null)} />
      ) : null}
    </>
  );
}

/**
 * A linha é um botão quando dá para editar, e uma linha quando não dá.
 *
 * O mesmo desenho nos dois casos: quem não é admin não deve ver afordância que
 * não vai funcionar, e quem é não deve ter que caçar um ícone de 16px.
 */
function LinhaDeServico({
  servico,
  canSeeMargin,
  onEditar,
}: {
  servico: ServiceRow;
  canSeeMargin: boolean;
  onEditar?: () => void;
}) {
  const margem =
    servico.priceCents > 0 && servico.costCents > 0
      ? Math.round(((servico.priceCents - servico.costCents) / servico.priceCents) * 100)
      : null;

  const contexto = [
    servico.professionalNames.length > 0
      ? servico.professionalNames.map((n) => n.split(" ")[0]).join(", ")
      : "Nenhum profissional habilitado",
    servico.requiredResourceType ? RECURSO[servico.requiredResourceType] : null,
    servico.returnIntervalDays ? `retorno a cada ${servico.returnIntervalDays} dias` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const conteudo = (
    <>
      {/* No celular o nome ocupa a linha inteira: quem é o serviço nunca é o
          dado sacrificado pela coluna. */}
      <span className="min-w-0 basis-full sm:flex-[2] sm:basis-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-label text-ink">{servico.name}</span>
          {!servico.active ? <Badge tone="neutral">Inativo</Badge> : null}
          {/* O normal é aceitar agendamento online — só a exceção merece selo. */}
          {!servico.onlineBooking ? <Badge tone="neutral">Fora do agendamento online</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate text-caption text-ink-secondary">{contexto}</span>
      </span>

      <span className="w-16 shrink-0 text-caption tabular text-ink-secondary">
        {servico.durationMin} min
      </span>
      <span className="w-24 shrink-0 text-right text-label tabular text-ink">
        {formatBRL(servico.priceCents)}
      </span>
      {canSeeMargin ? (
        <span className="shrink-0 text-caption tabular text-ink-secondary sm:w-16 sm:text-right">
          {margem !== null ? `${margem}%` : "—"}
          {/* Sem cabeçalho de coluna no celular, o número carrega o próprio rótulo. */}
          <span className="sm:sr-only"> de margem</span>
        </span>
      ) : null}
      {onEditar ? (
        <Pencil
          // Visível também no celular: lá o lápis é a ÚNICA pista de que a
          // linha inteira é tocável — sem ele a lista parece um relatório.
          className="size-3.5 shrink-0 text-ink-tertiary transition-colors group-hover:text-accent"
          aria-hidden
        />
      ) : null}
    </>
  );

  if (!onEditar) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">{conteudo}</div>
    );
  }
  return (
    <button
      type="button"
      onClick={onEditar}
      className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
    >
      {conteudo}
      <span className="sr-only">Editar {servico.name}</span>
    </button>
  );
}

function LinhaDeProduto({
  produto,
  canSeeMargin,
  onEditar,
}: {
  produto: ProductRow;
  canSeeMargin: boolean;
  onEditar?: () => void;
}) {
  const margem =
    produto.priceCents > 0
      ? Math.round(((produto.priceCents - produto.costCents) / produto.priceCents) * 100)
      : null;
  const contexto = [
    produto.categoryName,
    produto.sku ? `SKU ${produto.sku}` : null,
    `${produto.stockQty} em estoque`,
  ]
    .filter(Boolean)
    .join(" · ");

  const conteudo = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-label text-ink">{produto.name}</span>
          {!produto.active ? <Badge tone="neutral">Inativo</Badge> : null}
        </span>
        <span className="block truncate text-caption text-ink-secondary">{contexto}</span>
      </span>
      <span className="text-label tabular text-ink">{formatBRL(produto.priceCents)}</span>
      {canSeeMargin ? (
        <span className="w-14 text-right text-caption tabular text-ink-secondary">
          {margem === null ? "—" : `${margem}%`}
        </span>
      ) : null}
      {onEditar ? (
        <Pencil
          // Visível também no celular: lá o lápis é a ÚNICA pista de que a
          // linha inteira é tocável — sem ele a lista parece um relatório.
          className="size-3.5 shrink-0 text-ink-tertiary transition-colors group-hover:text-accent"
          aria-hidden
        />
      ) : null}
    </>
  );

  if (!onEditar) {
    return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">{conteudo}</div>;
  }
  return (
    <button
      type="button"
      onClick={onEditar}
      className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
    >
      {conteudo}
      <span className="sr-only">Editar {produto.name}</span>
    </button>
  );
}

function FormError({ result }: { result: CatalogResult | null }) {
  return result && !result.ok ? (
    <p role="alert" className="text-caption text-danger">
      {result.error}
    </p>
  ) : null;
}

function Footer({
  pending,
  disabled,
  close,
  label,
}: {
  pending: boolean;
  disabled?: boolean;
  close: () => void;
  label: string;
}) {
  return (
    <>
      <Button variant="ghost" onClick={close}>
        Cancelar
      </Button>
      <Button
        variant="primary"
        loading={pending}
        disabled={disabled}
        onClick={() => document.getElementById("catalog-submit")?.click()}
      >
        {label}
      </Button>
    </>
  );
}

function ServiceSheet({
  professionals,
  servico,
  close,
}: {
  professionals: Option[];
  servico: ServiceRow | null;
  close: () => void;
}) {
  const editando = servico !== null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<CatalogResult | null>(null);

  const [name, setName] = useState(servico?.name ?? "");
  const [categoryName, setCategory] = useState(servico?.categoryName ?? "");
  const [description, setDescription] = useState(servico?.description ?? "");
  const [durationMin, setDuration] = useState(servico?.durationMin ?? 60);
  const [price, setPrice] = useState(deCentavos(servico?.priceCents ?? 0));
  const [cost, setCost] = useState(deCentavos(servico?.costCents ?? 0));
  const [commission, setCommission] = useState(
    // Ponto, e não vírgula: o campo é `type="number"`, e o navegador descarta o
    // valor com vírgula como inválido — 12,5% abria a gaveta EM BRANCO, e daí
    // salvar apagava a comissão de quem só queria mexer no preço.
    servico?.commissionBps != null ? String(servico.commissionBps / 100) : "",
  );
  const [returnDays, setReturnDays] = useState(
    servico?.returnIntervalDays != null ? String(servico.returnIntervalDays) : "",
  );
  const [resource, setResource] = useState(servico?.requiredResourceType ?? "");
  const [onlineBooking, setOnline] = useState(servico?.onlineBooking ?? true);
  const [professionalIds, setProfessionalIds] = useState<number[]>(servico?.professionalIds ?? []);

  const custoMudou = editando && (paraCentavos(cost) ?? 0) !== servico.costCents;
  const comissaoMudou =
    editando &&
    (commission ? Math.round(Number(commission.replace(",", ".")) * 100) : null) !==
      servico.commissionBps;

  const submit = () =>
    startTransition(async () => {
      const result = await saveServiceAction(
        {
          name,
          categoryName,
          description,
          durationMin,
          priceCents: paraCentavos(price) ?? 0,
          costCents: paraCentavos(cost) ?? 0,
          commissionPct: commission ? Number(commission.replace(",", ".")) : null,
          returnIntervalDays: returnDays ? Number(returnDays) : null,
          requiredResourceType: resource || null,
          onlineBooking,
          professionalIds,
        },
        servico?.id,
      );
      if (result.ok) {
        toast.success(editando ? "Serviço salvo" : "Serviço cadastrado");
        router.refresh();
        close();
      } else setError(result);
    });

  return (
    <Sheet open onOpenChange={(v) => !v && close()}>
      <SheetContent
        title={editando ? "Editar serviço" : "Novo serviço"}
        description="Serviço agendável com preço, duração e profissionais habilitados."
        footer={
          <Footer
            pending={pending}
            disabled={!name.trim() || !precoValido(price)}
            close={close}
            label={editando ? "Salvar serviço" : "Cadastrar serviço"}
          />
        }
      >
        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button id="catalog-submit" hidden type="submit" />
          <Field label="Nome" htmlFor="service-name">
            <Input
              id="service-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Esmaltação em gel"
            />
          </Field>
          <Field
            label="Categoria"
            htmlFor="service-category"
            optional
            hint="É criada automaticamente se ainda não existir"
          >
            <Input
              id="service-category"
              value={categoryName}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex.: Unhas em gel"
            />
          </Field>
          <Field label="Descrição" htmlFor="service-description" optional>
            <Textarea
              id="service-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Duração" htmlFor="service-duration" hint="em minutos">
              <Input
                id="service-duration"
                type="number"
                min="5"
                step="5"
                value={durationMin}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </Field>
            <Field label="Preço" htmlFor="service-price">
              <Input
                id="service-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="80,00"
              />
            </Field>
            <Field label="Custo" htmlFor="service-cost" optional>
              <Input
                id="service-cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="15,00"
              />
            </Field>
          </div>

          {/* Os dois avisos que só a EDIÇÃO precisa dar. Ver o porquê em cada um. */}
          {custoMudou ? (
            <Aviso>
              O relatório financeiro calcula o custo dos atendimentos já concluídos lendo este
              campo. Mudar aqui muda a margem de meses que já fecharam.
            </Aviso>
          ) : null}
          {comissaoMudou ? (
            <Aviso>
              A comissão é calculada quando o atendimento é concluído. Atendimentos já feitos e
              ainda não concluídos vão usar o valor novo.
            </Aviso>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Comissão (%)" htmlFor="service-commission" optional>
              <Input
                id="service-commission"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </Field>
            <Field label="Retorno ideal (dias)" htmlFor="service-return" optional>
              <Input
                id="service-return"
                type="number"
                min="1"
                max="365"
                value={returnDays}
                onChange={(e) => setReturnDays(e.target.value)}
                placeholder="Ex.: 21"
              />
            </Field>
          </div>
          <Field
            label="Recurso exclusivo"
            htmlFor="service-resource"
            optional
            hint="Use apenas quando o mesmo espaço ou aparelho não puder atender duas clientes ao mesmo tempo."
          >
            <Select
              id="service-resource"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">Nenhum</option>
              <option value="room">Sala exclusiva</option>
              <option value="cabin">Cabine exclusiva</option>
              <option value="equipment">Equipamento exclusivo</option>
            </Select>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-label text-ink">Profissionais habilitados</legend>
            {professionals.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {professionals.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-label"
                  >
                    <input
                      type="checkbox"
                      checked={professionalIds.includes(p.id)}
                      onChange={(e) =>
                        setProfessionalIds(
                          e.target.checked
                            ? [...professionalIds, p.id]
                            : professionalIds.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-caption text-ink-secondary">
                Cadastre o profissional em Gestão; o serviço pode ser criado agora e vinculado
                depois.
              </p>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-label text-ink">
            <input
              type="checkbox"
              checked={onlineBooking}
              onChange={(e) => setOnline(e.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Disponível no agendamento online
          </label>
          <FormError result={error} />

          {editando ? (
            <Situacao
              ativo={servico.active}
              nome={servico.name}
              serviceId={servico.id}
              onPronto={() => {
                router.refresh();
                close();
              }}
            />
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProductSheet({ produto, close }: { produto: ProductRow | null; close: () => void }) {
  const editando = produto !== null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<CatalogResult | null>(null);
  const [name, setName] = useState(produto?.name ?? "");
  const [categoryName, setCategory] = useState(produto?.categoryName ?? "");
  const [description, setDescription] = useState(produto?.description ?? "");
  const [sku, setSku] = useState(produto?.sku ?? "");
  const [price, setPrice] = useState(deCentavos(produto?.priceCents ?? 0));
  const [cost, setCost] = useState(deCentavos(produto?.costCents ?? 0));
  const [stockQty, setStock] = useState(produto?.stockQty ?? 0);

  const submit = () =>
    startTransition(async () => {
      const result = await saveProductAction(
        {
          name,
          categoryName,
          description,
          sku,
          priceCents: paraCentavos(price) ?? 0,
          costCents: paraCentavos(cost) ?? 0,
          stockQty,
        },
        produto?.id,
      );
      if (result.ok) {
        toast.success(editando ? "Produto salvo" : "Produto cadastrado");
        router.refresh();
        close();
      } else setError(result);
    });

  return (
    <Sheet open onOpenChange={(v) => !v && close()}>
      <SheetContent
        title={editando ? "Editar produto" : "Novo produto"}
        description="Item físico para venda ou controle no catálogo."
        footer={
          <Footer
            pending={pending}
            disabled={!name.trim() || !precoValido(price)}
            close={close}
            label={editando ? "Salvar produto" : "Cadastrar produto"}
          />
        }
      >
        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button id="catalog-submit" hidden type="submit" />
          <Field label="Nome" htmlFor="product-name">
            <Input
              id="product-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Óleo de cutícula"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoria" htmlFor="product-category" optional>
              <Input
                id="product-category"
                value={categoryName}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Ex.: Cuidados"
              />
            </Field>
            <Field label="SKU / código" htmlFor="product-sku" optional>
              <Input id="product-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </Field>
          </div>
          <Field label="Descrição" htmlFor="product-description" optional>
            <Textarea
              id="product-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Preço" htmlFor="product-price">
              <Input
                id="product-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="35,00"
              />
            </Field>
            <Field label="Custo" htmlFor="product-cost" optional>
              <Input
                id="product-cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="12,00"
              />
            </Field>
            <Field label="Estoque" htmlFor="product-stock">
              <Input
                id="product-stock"
                type="number"
                min="0"
                value={stockQty}
                onChange={(e) => setStock(Number(e.target.value))}
              />
            </Field>
          </div>
          <FormError result={error} />

          {editando ? (
            <SituacaoProduto
              ativo={produto.active}
              nome={produto.name}
              productId={produto.id}
              onPronto={() => {
                router.refresh();
                close();
              }}
            />
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control bg-attention-soft px-3 py-2 text-caption text-attention">
      {children}
    </p>
  );
}

/**
 * Desativar em vez de excluir.
 *
 * `appointments.service_id` é chave estrangeira: apagar um serviço que já
 * atendeu alguém ou o banco recusa, ou levaria o histórico junto. Inativo some
 * da agenda e do agendamento online, e o atendimento de março continua tendo
 * nome na ficha da cliente.
 */
function Situacao({
  ativo,
  nome,
  serviceId,
  onPronto,
}: {
  ativo: boolean;
  nome: string;
  serviceId: number;
  onPronto: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [futuros, setFuturos] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const pedirConfirmacao = () =>
    startTransition(async () => {
      const resultado = await contarFuturosAction(serviceId);
      // `null` é "não sei", e não é zero: a consulta que falhou não pode virar
      // a frase "nenhum atendimento futuro depende dele" na tela de quem está
      // decidindo se desativa.
      setFuturos(resultado.ok ? resultado.total : null);
      setConfirmando(true);
    });

  const aplicar = (proximo: boolean) =>
    startTransition(async () => {
      const resultado = await setServiceActiveAction(serviceId, proximo);
      if (resultado.ok) {
        toast.success(proximo ? "Serviço reativado" : "Serviço desativado");
        onPronto();
      } else toast.error(resultado.error);
    });

  if (!ativo) {
    return (
      <div className="border-t border-line pt-4">
        <p className="text-caption text-ink-secondary">
          Este serviço está inativo: não aparece na agenda nem no agendamento online.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          loading={pending}
          onClick={() => aplicar(true)}
        >
          Reativar serviço
        </Button>
      </div>
    );
  }

  if (confirmando) {
    return (
      <div className="border-t border-line pt-4">
        <p className="text-label text-ink">Desativar {nome}?</p>
        <p className="mt-1 text-caption text-ink-secondary">
          Ele sai da agenda e do agendamento online.{" "}
          {futuros === null
            ? "Não consegui conferir a agenda agora; o que já estiver marcado continua de pé, e o histórico não muda."
            : futuros > 0
              ? `${futuros === 1 ? "O atendimento já marcado continua" : `Os ${futuros} atendimentos já marcados continuam`} de pé, e o histórico não muda.`
              : "Nenhum atendimento futuro depende dele, e o histórico não muda."}
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={pending}
            onClick={() => aplicar(false)}
          >
            Desativar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmando(false)}>
            Manter ativo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-line pt-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={pending}
        onClick={pedirConfirmacao}
        className="text-danger"
      >
        Desativar serviço
      </Button>
    </div>
  );
}

function SituacaoProduto({
  ativo,
  nome,
  productId,
  onPronto,
}: {
  ativo: boolean;
  nome: string;
  productId: number;
  onPronto: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const aplicar = (proximo: boolean) =>
    startTransition(async () => {
      const resultado = await setProductActiveAction(productId, proximo);
      if (resultado.ok) {
        toast.success(proximo ? "Produto reativado" : "Produto desativado");
        onPronto();
      } else toast.error(resultado.error);
    });

  return (
    <div className="border-t border-line pt-4">
      <p className="text-caption text-ink-secondary">
        {ativo
          ? `Desativar marca ${nome} como fora de linha no catálogo.`
          : "Este produto está marcado como inativo no catálogo."}
      </p>
      <Button
        type="button"
        variant={ativo ? "ghost" : "secondary"}
        size="sm"
        className={ativo ? "mt-2 text-danger" : "mt-2"}
        loading={pending}
        onClick={() => aplicar(!ativo)}
      >
        {ativo ? "Desativar produto" : "Reativar produto"}
      </Button>
    </div>
  );
}
