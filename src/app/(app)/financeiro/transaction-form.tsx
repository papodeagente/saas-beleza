"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { createTransactionAction, type TransactionResult } from "./actions";

const cents = (value: string) => Math.round(Number(value.replace(",", ".") || 0) * 100);

export function TransactionForm({ branches }: { branches: Array<{ id: number; name: string }> }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [pending, startTransition] = useTransition(); const [error, setError] = useState<TransactionResult | null>(null);
  const [kind, setKind] = useState<"income"|"expense">("expense"); const [description, setDescription] = useState(""); const [amount, setAmount] = useState(""); const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0,10)); const [status, setStatus] = useState<"pending"|"paid">("paid"); const [branchId, setBranchId] = useState<number|null>(branches[0]?.id ?? null); const [categoryName, setCategory] = useState("");
  const submit = () => startTransition(async () => { const result = await createTransactionAction({ kind, description, amountCents: cents(amount), dueDate, status, branchId, categoryName }); if (result.ok) { toast.success("Lançamento criado"); router.refresh(); setOpen(false); } else setError(result); });
  return <><Button variant="primary" onClick={() => setOpen(true)}><Plus />Novo lançamento</Button>{open ? <Sheet open onOpenChange={setOpen}><SheetContent title="Novo lançamento" description="Registre receitas e despesas que não nasceram de um atendimento." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={pending} disabled={!description.trim() || !amount} onClick={() => document.getElementById("transaction-submit")?.click()}>Salvar lançamento</Button></>}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(); }}><button id="transaction-submit" hidden type="submit" />
      <div className="grid grid-cols-2 gap-4"><Field label="Tipo" htmlFor="transaction-kind"><Select id="transaction-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="expense">Despesa</option><option value="income">Receita</option></Select></Field><Field label="Situação" htmlFor="transaction-status"><Select id="transaction-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="paid">Pago</option><option value="pending">Em aberto</option></Select></Field></div>
      <Field label="Descrição" htmlFor="transaction-description"><Input id="transaction-description" autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Compra de materiais" /></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Valor (R$)" htmlFor="transaction-amount"><Input id="transaction-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150,00" /></Field><Field label="Data" htmlFor="transaction-date"><Input id="transaction-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field></div>
      <Field label="Categoria" htmlFor="transaction-category" optional hint="Criada automaticamente se for nova"><Input id="transaction-category" value={categoryName} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Materiais" /></Field>
      <Field label="Unidade" htmlFor="transaction-branch" optional><Select id="transaction-branch" value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}><option value="">Sem unidade específica</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      {error && !error.ok ? <p role="alert" className="text-caption text-danger">{error.error}</p> : null}
    </form>
  </SheetContent></Sheet> : null}</>;
}
