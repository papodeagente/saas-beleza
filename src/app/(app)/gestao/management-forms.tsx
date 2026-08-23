"use client";

import { Building2, DoorOpen, UserRound, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  createBranchAction,
  createMemberAction,
  createProfessionalAction,
  createResourceAction,
  type CadastroResult,
} from "./actions";

type Kind = "branch" | "professional" | "resource" | "member" | null;
type Option = { id: number; name: string };
const DAYS = [
  [1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [0, "Dom"],
] as const;

function Checks({ options, values, onChange }: { options: Option[]; values: number[]; onChange: (ids: number[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label key={option.id} className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-label text-ink">
          <input type="checkbox" checked={values.includes(option.id)} onChange={(event) => onChange(event.target.checked ? [...values, option.id] : values.filter((id) => id !== option.id))} className="size-4 accent-[var(--color-accent)]" />
          {option.name}
        </label>
      ))}
    </div>
  );
}

function Actions({ pending, disabled, label, close }: { pending: boolean; disabled?: boolean; label: string; close: () => void }) {
  return <><Button variant="ghost" onClick={close}>Cancelar</Button><Button loading={pending} disabled={disabled} onClick={() => document.getElementById("cadastro-submit")?.click()}>{label}</Button></>;
}

export function ManagementForms({ branches, services }: { branches: Option[]; services: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<CadastroResult | null>(null);
  const close = () => { setOpen(null); setError(null); };
  const submit = (action: () => Promise<CadastroResult>, success: string) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) { toast.success(success); router.refresh(); close(); }
      else setError(result);
    });
  };

  return (
    <>
      <div className="flex flex-wrap gap-2" aria-label="Novos cadastros">
        <Button onClick={() => setOpen("branch")}><Building2 />Nova unidade</Button>
        <Button variant="secondary" onClick={() => setOpen("professional")} disabled={!branches.length}><UserRound />Novo profissional</Button>
        <Button variant="secondary" onClick={() => setOpen("member")} disabled={!branches.length}><Users />Novo usuário</Button>
        <Button variant="secondary" onClick={() => setOpen("resource")} disabled={!branches.length}><DoorOpen />Sala ou recurso</Button>
      </div>
      {!branches.length ? <p className="mt-2 text-caption text-ink-secondary">Cadastre a primeira unidade para liberar profissionais, usuários e recursos.</p> : null}

      {open === "branch" ? <BranchSheet pending={pending} error={error} close={close} submit={submit} /> : null}
      {open === "resource" ? <ResourceSheet branches={branches} pending={pending} error={error} close={close} submit={submit} /> : null}
      {open === "professional" ? <ProfessionalSheet branches={branches} services={services} pending={pending} error={error} close={close} submit={submit} /> : null}
      {open === "member" ? <MemberSheet branches={branches} pending={pending} error={error} close={close} submit={submit} /> : null}
    </>
  );
}

type SheetProps = { pending: boolean; error: CadastroResult | null; close: () => void; submit: (action: () => Promise<CadastroResult>, success: string) => void };

function ErrorMessage({ result }: { result: CadastroResult | null }) {
  return result && !result.ok ? <p role="alert" className="text-caption text-danger">{result.error}</p> : null;
}

function BranchSheet({ pending, error, close, submit }: SheetProps) {
  const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [phone, setPhone] = useState("");
  return <Sheet open onOpenChange={(v) => !v && close()}><SheetContent title="Nova unidade" description="Local onde os atendimentos acontecem." footer={<Actions pending={pending} disabled={name.trim().length < 2} label="Cadastrar unidade" close={close} />}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(() => createBranchAction({ name, address, phone }), "Unidade cadastrada"); }}>
      <button id="cadastro-submit" type="submit" hidden />
      <Field label="Nome" htmlFor="branch-name"><Input id="branch-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Unidade Centro" /></Field>
      <Field label="Endereço" htmlFor="branch-address" optional><Input id="branch-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número e bairro" /></Field>
      <Field label="Telefone" htmlFor="branch-phone" optional><Input id="branch-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(84) 99999-0000" /></Field>
      <ErrorMessage result={error} />
    </form>
  </SheetContent></Sheet>;
}

function ResourceSheet({ branches, pending, error, close, submit }: SheetProps & { branches: Option[] }) {
  const [name, setName] = useState(""); const [branchId, setBranchId] = useState(branches[0]?.id ?? 0); const [type, setType] = useState<"room"|"cabin"|"equipment">("room");
  return <Sheet open onOpenChange={(v) => !v && close()}><SheetContent title="Nova sala ou recurso" description="Evita que dois atendimentos ocupem o mesmo espaço ou equipamento." footer={<Actions pending={pending} disabled={!name.trim()} label="Cadastrar recurso" close={close} />}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(() => createResourceAction({ name, branchId, type }), "Recurso cadastrado"); }}>
      <button id="cadastro-submit" type="submit" hidden />
      <Field label="Unidade" htmlFor="resource-branch"><Select id="resource-branch" value={branchId} onChange={(e) => setBranchId(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <Field label="Tipo" htmlFor="resource-type"><Select id="resource-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="room">Sala</option><option value="cabin">Cabine</option><option value="equipment">Equipamento</option></Select></Field>
      <Field label="Nome" htmlFor="resource-name"><Input id="resource-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Mesa 2" /></Field>
      <ErrorMessage result={error} />
    </form>
  </SheetContent></Sheet>;
}

function ProfessionalSheet({ branches, services, pending, error, close, submit }: SheetProps & { branches: Option[]; services: Option[] }) {
  const [name, setName] = useState(""); const [specialty, setSpecialty] = useState(""); const [branchId, setBranchId] = useState(branches[0]?.id ?? 0);
  const [commissionPct, setCommission] = useState(0); const [color, setColor] = useState("#9157CD"); const [weekdays, setWeekdays] = useState<number[]>([1,2,3,4,5]);
  const [startTime, setStart] = useState("08:00"); const [endTime, setEnd] = useState("18:00"); const [serviceIds, setServiceIds] = useState<number[]>([]);
  return <Sheet open onOpenChange={(v) => !v && close()}><SheetContent title="Novo profissional" description="Cria o atendente e sua grade semanal na unidade." footer={<Actions pending={pending} disabled={!name.trim() || !weekdays.length} label="Cadastrar profissional" close={close} />}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(() => createProfessionalAction({ name, specialty, branchId, commissionPct, color, weekdays, startTime, endTime, serviceIds }), "Profissional cadastrado"); }}>
      <button id="cadastro-submit" type="submit" hidden />
      <Field label="Nome" htmlFor="professional-name"><Input id="professional-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome e sobrenome" /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Especialidade" htmlFor="professional-specialty" optional><Input id="professional-specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ex.: Nail designer" /></Field><Field label="Unidade" htmlFor="professional-branch"><Select id="professional-branch" value={branchId} onChange={(e) => setBranchId(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Comissão (%)" htmlFor="professional-commission"><Input id="professional-commission" type="number" min="0" max="100" step="0.1" value={commissionPct} onChange={(e) => setCommission(Number(e.target.value))} /></Field><Field label="Cor na agenda" htmlFor="professional-color"><Input id="professional-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field></div>
      <fieldset><legend className="mb-1.5 text-label text-ink">Dias de atendimento</legend><div className="flex flex-wrap gap-2">{DAYS.map(([id,label]) => <label key={id} className="flex items-center gap-1.5 rounded-pill border border-line px-2.5 py-1.5 text-caption"><input type="checkbox" checked={weekdays.includes(id)} onChange={(e) => setWeekdays(e.target.checked ? [...weekdays,id] : weekdays.filter((d) => d !== id))} />{label}</label>)}</div></fieldset>
      <div className="grid grid-cols-2 gap-4"><Field label="Início" htmlFor="professional-start"><Input id="professional-start" type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Fim" htmlFor="professional-end"><Input id="professional-end" type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} /></Field></div>
      <fieldset><legend className="mb-1.5 text-label text-ink">Serviços que realiza</legend>{services.length ? <Checks options={services} values={serviceIds} onChange={setServiceIds} /> : <p className="text-caption text-ink-secondary">Nenhum serviço cadastrado. Você poderá vinculá-lo ao criar o serviço.</p>}</fieldset>
      <ErrorMessage result={error} />
    </form>
  </SheetContent></Sheet>;
}

function MemberSheet({ branches, pending, error, close, submit }: SheetProps & { branches: Option[] }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<"admin"|"staff"|"professional">("staff"); const [branchIds, setBranchIds] = useState<number[]>(branches[0] ? [branches[0].id] : []);
  return <Sheet open onOpenChange={(v) => !v && close()}><SheetContent title="Novo usuário" description="Pessoa que poderá entrar no sistema nas unidades selecionadas." footer={<Actions pending={pending} disabled={!name.trim() || !email.trim() || password.length < 8 || !branchIds.length} label="Criar acesso" close={close} />}>
    <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(() => createMemberAction({ name, email, password, role, branchIds }), "Acesso criado"); }}>
      <button id="cadastro-submit" type="submit" hidden />
      <Field label="Nome" htmlFor="member-name"><Input id="member-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="E-mail de acesso" htmlFor="member-email"><Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Senha temporária" htmlFor="member-password" hint="Mínimo de 8 caracteres"><Input id="member-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Field label="Permissão" htmlFor="member-role"><Select id="member-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="admin">Administração</option><option value="staff">Recepção</option><option value="professional">Profissional</option></Select></Field>
      <fieldset><legend className="mb-1.5 text-label text-ink">Unidades permitidas</legend><Checks options={branches} values={branchIds} onChange={setBranchIds} /></fieldset>
      <ErrorMessage result={error} />
    </form>
  </SheetContent></Sheet>;
}
