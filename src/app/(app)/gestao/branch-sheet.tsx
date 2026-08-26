"use client";

import { Check, Loader2, MapPin } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  type CadastroResult,
  buscarCepAction,
  createBranchAction,
  updateBranchAction,
} from "./actions";

export type BranchParaEditar = {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
  ibgeCode: number | null;
};

/** Formata 59020000 como 59020-000 enquanto se digita. */
function mascaraCep(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Monta o endereço de uma linha a partir das partes.
 *
 * O `address` de uma linha continua sendo o campo que aparece no bilhete de
 * confirmação e no cartão do diretório — quem lê quer o endereço escrito, não
 * seis campos. Ele é COMPOSTO do que a clínica preencheu em vez de ser um
 * sétimo campo para ela digitar de novo.
 */
function comporEndereco(p: {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
}): string | null {
  const rua = [p.street, p.number].filter(Boolean).join(", ");
  const primeiro = [rua, p.complement].filter(Boolean).join(" — ");
  const local = [p.city, p.uf].filter(Boolean).join("/");
  const partes = [primeiro, p.district, local].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

export function BranchSheet({
  branch,
  onClose,
  onSaved,
}: {
  /** Ausente = cadastro novo. */
  branch?: BranchParaEditar;
  onClose: () => void;
  onSaved: (mensagem: string) => void;
}) {
  const editando = Boolean(branch);
  const [name, setName] = useState(branch?.name ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [cep, setCep] = useState(mascaraCep(branch?.postalCode ?? ""));
  const [street, setStreet] = useState(branch?.street ?? "");
  const [numero, setNumero] = useState(branch?.number ?? "");
  const [complement, setComplement] = useState(branch?.complement ?? "");
  const [district, setDistrict] = useState(branch?.district ?? "");
  const [city, setCity] = useState(branch?.city ?? "");
  const [uf, setUf] = useState(branch?.uf ?? "");
  const [ibgeCode, setIbgeCode] = useState<number | null>(branch?.ibgeCode ?? null);
  /** Endereço livre, para quem não tem CEP ou prefere escrever. */
  const [addressLivre, setAddressLivre] = useState(branch?.street ? "" : (branch?.address ?? ""));

  const [buscandoCep, iniciarBuscaCep] = useTransition();
  const [erroCep, setErroCep] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<CadastroResult | null>(null);

  const temEnderecoEstruturado = Boolean(city && uf);

  function buscar(valor: string) {
    const digitos = valor.replace(/\D/g, "");
    if (digitos.length !== 8) return;
    setErroCep(null);
    iniciarBuscaCep(async () => {
      const r = await buscarCepAction(digitos);
      if (!r.ok) {
        setErroCep(r.error);
        return;
      }
      setStreet(r.endereco.street ?? "");
      setDistrict(r.endereco.district ?? "");
      setCity(r.endereco.city);
      setUf(r.endereco.uf);
      setIbgeCode(r.endereco.ibgeCode);
      setAddressLivre("");
    });
  }

  function salvar() {
    setError(null);
    const estrutura = {
      street: street || null,
      number: numero || null,
      complement: complement || null,
      district: district || null,
      city: city || null,
      uf: uf || null,
    };
    const address = temEnderecoEstruturado ? comporEndereco(estrutura) : addressLivre || null;
    const dados = {
      name,
      phone,
      address,
      postalCode: cep.replace(/\D/g, "") || undefined,
      ...Object.fromEntries(Object.entries(estrutura).map(([k, v]) => [k, v ?? undefined])),
      ibgeCode: ibgeCode ?? undefined,
    };
    startTransition(async () => {
      const r = branch
        ? await updateBranchAction({ ...dados, branchId: branch.id })
        : await createBranchAction(dados);
      if (r.ok) onSaved(editando ? "Unidade atualizada" : "Unidade cadastrada");
      else setError(r);
    });
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        title={editando ? "Editar unidade" : "Nova unidade"}
        description="O endereço é o que coloca você no mapa da busca por cidade."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={name.trim().length < 2}
              onClick={salvar}
            >
              {editando ? "Salvar" : "Cadastrar unidade"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">
          <Field label="Nome" htmlFor="branch-name">
            <Input
              id="branch-name"
              autoFocus={!editando}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Unidade Centro"
            />
          </Field>

          <Field
            label="CEP"
            htmlFor="branch-cep"
            optional
            hint="Preenche rua, bairro e cidade sozinho."
          >
            <div className="flex items-center gap-2">
              <Input
                id="branch-cep"
                value={cep}
                inputMode="numeric"
                placeholder="00000-000"
                onChange={(e) => {
                  const v = mascaraCep(e.target.value);
                  setCep(v);
                  buscar(v);
                }}
                onBlur={(e) => buscar(e.target.value)}
              />
              {buscandoCep ? (
                <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-ink-tertiary" />
              ) : temEnderecoEstruturado ? (
                <Check aria-hidden className="size-4 shrink-0 text-positive" />
              ) : null}
            </div>
          </Field>
          {erroCep ? (
            <p role="alert" className="-mt-2 text-caption text-danger">
              {erroCep}
            </p>
          ) : null}

          {temEnderecoEstruturado ? (
            <>
              {/* O que veio do CEP aparece escrito, não como campo: é dado
                  confirmado por serviço externo, e transformar em campo editável
                  convida a divergir do código do IBGE que ficou guardado. */}
              <div className="flex items-start gap-2.5 rounded-card bg-accent-soft/60 px-3.5 py-3">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-label text-ink">{street || "Sem logradouro no CEP"}</p>
                  <p className="mt-0.5 text-caption text-ink-secondary">
                    {[district, `${city}/${uf}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Número" htmlFor="branch-numero">
                  <Input
                    id="branch-numero"
                    value={numero}
                    inputMode="numeric"
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="123"
                  />
                </Field>
                <Field label="Complemento" htmlFor="branch-compl" optional>
                  <Input
                    id="branch-compl"
                    value={complement}
                    onChange={(e) => setComplement(e.target.value)}
                    placeholder="Sala 2"
                  />
                </Field>
              </div>
            </>
          ) : (
            <Field
              label="Endereço"
              htmlFor="branch-address"
              optional
              hint="Sem CEP a unidade não entra na busca por cidade."
            >
              <Input
                id="branch-address"
                value={addressLivre}
                onChange={(e) => setAddressLivre(e.target.value)}
                placeholder="Rua, número e bairro"
              />
            </Field>
          )}

          <Field label="Telefone" htmlFor="branch-phone" optional>
            <Input
              id="branch-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(84) 99999-0000"
            />
          </Field>

          {error && !error.ok ? (
            <p role="alert" className="text-caption text-danger">
              {error.error}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
