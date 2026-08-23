"use client";

import { PackagePlus, Scissors } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { createProductAction, createServiceAction, type CatalogResult } from "./actions";

type Option = { id: number; name: string };
type Kind = "service" | "product" | null;
const toCents = (value: string) => Math.round(Number(value.replace(",", ".") || 0) * 100);

export function CatalogForms({ professionals }: { professionals: Option[] }) {
  const [open, setOpen] = useState<Kind>(null);
  return <>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setOpen("service")}><Scissors />Novo serviço</Button>
      <Button variant="secondary" onClick={() => setOpen("product")}><PackagePlus />Novo produto</Button>
    </div>
    {open === "service" ? <ServiceSheet professionals={professionals} close={() => setOpen(null)} /> : null}
    {open === "product" ? <ProductSheet close={() => setOpen(null)} /> : null}
  </>;
}

function FormError({ result }: { result: CatalogResult | null }) {
  return result && !result.ok ? <p role="alert" className="text-caption text-danger">{result.error}</p> : null;
}

function Footer({ pending, disabled, close, label }: { pending: boolean; disabled?: boolean; close: () => void; label: string }) {
  return <><Button variant="ghost" onClick={close}>Cancelar</Button><Button loading={pending} disabled={disabled} onClick={() => document.getElementById("catalog-submit")?.click()}>{label}</Button></>;
}

function ServiceSheet({ professionals, close }: { professionals: Option[]; close: () => void }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<CatalogResult | null>(null);
  const [name, setName] = useState(""); const [categoryName, setCategory] = useState(""); const [description, setDescription] = useState("");
  const [durationMin, setDuration] = useState(60); const [price, setPrice] = useState(""); const [cost, setCost] = useState(""); const [commission, setCommission] = useState("");
  const [returnDays, setReturnDays] = useState(""); const [resource, setResource] = useState(""); const [onlineBooking, setOnline] = useState(true); const [professionalIds, setProfessionalIds] = useState<number[]>([]);
  const submit = () => startTransition(async () => {
    const result = await createServiceAction({ name, categoryName, description, durationMin, priceCents: toCents(price), costCents: toCents(cost), commissionPct: commission ? Number(commission.replace(",", ".")) : null, returnIntervalDays: returnDays ? Number(returnDays) : null, requiredResourceType: resource || null, onlineBooking, professionalIds });
    if (result.ok) { toast.success("Serviço cadastrado"); router.refresh(); close(); } else setError(result);
  });
  return <Sheet open onOpenChange={(v) => !v && close()}><SheetContent title="Novo serviço" description="Serviço agendável com preço, duração e profissionais habilitados." footer={<Footer pending={pending} disabled={!name.trim() || !price} close={close} label="Cadastrar serviço" />}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(); }}><button id="catalog-submit" hidden type="submit" />
      <Field label="Nome" htmlFor="service-name"><Input id="service-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Esmaltação em gel" /></Field>
      <Field label="Categoria" htmlFor="service-category" optional hint="É criada automaticamente se ainda não existir"><Input id="service-category" value={categoryName} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Unhas em gel" /></Field>
      <Field label="Descrição" htmlFor="service-description" optional><Textarea id="service-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Duração" htmlFor="service-duration"><Input id="service-duration" type="number" min="5" step="5" value={durationMin} onChange={(e) => setDuration(Number(e.target.value))} /></Field><Field label="Preço (R$)" htmlFor="service-price"><Input id="service-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="80,00" /></Field><Field label="Custo (R$)" htmlFor="service-cost" optional><Input id="service-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="15,00" /></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Comissão (%)" htmlFor="service-commission" optional><Input id="service-commission" type="number" min="0" max="100" step="0.1" value={commission} onChange={(e) => setCommission(e.target.value)} /></Field><Field label="Retorno ideal (dias)" htmlFor="service-return" optional><Input id="service-return" type="number" min="1" max="365" value={returnDays} onChange={(e) => setReturnDays(e.target.value)} placeholder="Ex.: 21" /></Field></div>
      <Field label="Recurso exclusivo" htmlFor="service-resource" optional hint="Use apenas quando o mesmo espaço ou aparelho não puder atender duas clientes ao mesmo tempo."><Select id="service-resource" value={resource} onChange={(e) => setResource(e.target.value)}><option value="">Nenhum</option><option value="room">Sala exclusiva</option><option value="cabin">Cabine exclusiva</option><option value="equipment">Equipamento exclusivo</option></Select></Field>
      <fieldset><legend className="mb-1.5 text-label text-ink">Profissionais habilitados</legend>{professionals.length ? <div className="grid gap-2 sm:grid-cols-2">{professionals.map((p) => <label key={p.id} className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-label"><input type="checkbox" checked={professionalIds.includes(p.id)} onChange={(e) => setProfessionalIds(e.target.checked ? [...professionalIds,p.id] : professionalIds.filter((id) => id !== p.id))} />{p.name}</label>)}</div> : <p className="text-caption text-ink-secondary">Cadastre o profissional em Gestão; o serviço pode ser criado agora e vinculado depois.</p>}</fieldset>
      <label className="flex items-center gap-2 text-label text-ink"><input type="checkbox" checked={onlineBooking} onChange={(e) => setOnline(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />Disponível no agendamento online</label>
      <FormError result={error} />
    </form>
  </SheetContent></Sheet>;
}

function ProductSheet({ close }: { close: () => void }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<CatalogResult | null>(null);
  const [name, setName] = useState(""); const [categoryName, setCategory] = useState(""); const [description, setDescription] = useState(""); const [sku, setSku] = useState(""); const [price, setPrice] = useState(""); const [cost, setCost] = useState(""); const [stockQty, setStock] = useState(0);
  const submit = () => startTransition(async () => { const result = await createProductAction({ name, categoryName, description, sku, priceCents: toCents(price), costCents: toCents(cost), stockQty }); if (result.ok) { toast.success("Produto cadastrado"); router.refresh(); close(); } else setError(result); });
  return <Sheet open onOpenChange={(v) => !v && close()}><SheetContent title="Novo produto" description="Item físico para venda ou controle no catálogo." footer={<Footer pending={pending} disabled={!name.trim() || !price} close={close} label="Cadastrar produto" />}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(); }}><button id="catalog-submit" hidden type="submit" />
      <Field label="Nome" htmlFor="product-name"><Input id="product-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Óleo de cutícula" /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Categoria" htmlFor="product-category" optional><Input id="product-category" value={categoryName} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Cuidados" /></Field><Field label="SKU / código" htmlFor="product-sku" optional><Input id="product-sku" value={sku} onChange={(e) => setSku(e.target.value)} /></Field></div>
      <Field label="Descrição" htmlFor="product-description" optional><Textarea id="product-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Preço (R$)" htmlFor="product-price"><Input id="product-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="35,00" /></Field><Field label="Custo (R$)" htmlFor="product-cost" optional><Input id="product-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field><Field label="Estoque" htmlFor="product-stock"><Input id="product-stock" type="number" min="0" value={stockQty} onChange={(e) => setStock(Number(e.target.value))} /></Field></div>
      <FormError result={error} />
    </form>
  </SheetContent></Sheet>;
}
