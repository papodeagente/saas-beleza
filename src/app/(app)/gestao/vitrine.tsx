"use client";

import { AlertTriangle, ExternalLink, MapPin, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { type CadastroResult, salvarVitrineAction } from "./actions";
import { BranchSheet, type BranchParaEditar } from "./branch-sheet";

export type EstadoDaVitrine = {
  listed: boolean;
  bio: string | null;
  whatsapp: string | null;
  instagram: string | null;
  nome: string;
  slug: string;
  servicosPublicados: number;
  precoMinCents: number | null;
  unidades: Array<BranchParaEditar & { active: boolean; pronta: boolean }>;
};

/**
 * A vitrine pública — onde o salão decide se aparece no diretório de manicures.
 *
 * O interruptor nasce DESLIGADO e essa é a decisão de produto mais importante
 * desta tela: publicar endereço, telefone e tabela de preços de um negócio real
 * é escolha da dona, não da plataforma.
 *
 * A tela também é onde ela descobre POR QUE não aparece. Um diretório que
 * simplesmente omite quem não preencheu o endereço, sem dizer, produz o suporte
 * que ninguém quer atender: "liguei e não apareci".
 */
export function Vitrine({ estado }: { estado: EstadoDaVitrine }) {
  const router = useRouter();
  const [listed, setListed] = useState(estado.listed);
  const [bio, setBio] = useState(estado.bio ?? "");
  const [whatsapp, setWhatsapp] = useState(estado.whatsapp ?? "");
  const [instagram, setInstagram] = useState(estado.instagram ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<CadastroResult | null>(null);
  const [editando, setEditando] = useState<BranchParaEditar | null>(null);

  const prontas = estado.unidades.filter((u) => u.active && u.pronta);
  const podeAparecer = prontas.length > 0 && estado.servicosPublicados > 0;

  function salvar(proximoListed = listed) {
    setError(null);
    startTransition(async () => {
      const r = await salvarVitrineAction({
        listed: proximoListed,
        bio,
        whatsapp,
        instagram,
      });
      if (r.ok) {
        setListed(proximoListed);
        toast.success(proximoListed ? "Sua vitrine está no ar" : "Vitrine desligada");
        router.refresh();
      } else {
        setError(r);
      }
    });
  }

  return (
    <>
      <Card className="mt-2.5 divide-y divide-line">
        {/* O interruptor */}
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent">
              <Store aria-hidden className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-card text-ink">Aparecer no Agenda de Unha</p>
              <p className="mt-1 max-w-prose text-caption text-ink-secondary">
                Seu salão entra no diretório público, onde as clientes procuram manicure por cidade
                ou perto de onde estão. Quem te achar agenda direto, sem criar conta.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {listed ? (
              <Button variant="ghost" className="h-11 md:h-9" asChild>
                <Link href={`/manicures/${estado.slug}`} target="_blank" rel="noreferrer">
                  Ver meu perfil
                  <ExternalLink aria-hidden />
                </Link>
              </Button>
            ) : null}
            <Button
              variant={listed ? "secondary" : "primary"}
              loading={pending}
              disabled={!listed && !podeAparecer}
              onClick={() => salvar(!listed)}
            >
              {listed ? "Sair do diretório" : "Entrar no diretório"}
            </Button>
          </div>
        </div>

        {/* O que falta, quando falta */}
        {!podeAparecer ? (
          <div className="flex gap-3 bg-attention-soft/60 px-4 py-3.5">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-attention" />
            <div className="min-w-0 text-caption text-ink">
              <p className="font-semibold">Falta pouco para entrar</p>
              <ul className="mt-1 space-y-0.5 text-ink-secondary">
                {estado.servicosPublicados === 0 ? (
                  <li>
                    Publique pelo menos um serviço para agendamento online, no{" "}
                    <Link href="/catalogo" className="text-accent underline-offset-2 hover:underline">
                      catálogo
                    </Link>
                    .
                  </li>
                ) : null}
                {prontas.length === 0 ? (
                  <li>Informe o CEP de pelo menos uma unidade — é ele que te coloca no mapa.</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Como o salão se apresenta */}
        <div className="space-y-4 px-4 py-4">
          <Field
            label="Sobre o seu trabalho"
            htmlFor="vitrine-bio"
            optional
            hint={`${bio.length}/280 — aparece no seu perfil, abaixo do nome.`}
          >
            <Textarea
              id="vitrine-bio"
              value={bio}
              rows={3}
              maxLength={280}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Ex.: Alongamento em fibra e blindagem. Atendimento com hora marcada, sem espera."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="WhatsApp público" htmlFor="vitrine-zap" optional>
              <Input
                id="vitrine-zap"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(84) 99999-0000"
              />
            </Field>
            <Field label="Instagram" htmlFor="vitrine-insta" optional>
              <Input
                id="vitrine-insta"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@seusalao"
              />
            </Field>
          </div>
          {error && !error.ok ? (
            <p role="alert" className="text-caption text-danger">
              {error.error}
            </p>
          ) : null}
          <div>
            <Button variant="secondary" loading={pending} onClick={() => salvar()}>
              Salvar apresentação
            </Button>
          </div>
        </div>

        {/* Onde você atende */}
        <div className="px-4 py-4">
          <p className="text-section">Onde você atende</p>
          <ul className="mt-2 space-y-2">
            {estado.unidades
              .filter((u) => u.active)
              .map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-3.5 py-3"
                >
                  <div className="flex min-w-0 gap-2.5">
                    <MapPin
                      aria-hidden
                      className={`mt-0.5 size-4 shrink-0 ${u.pronta ? "text-accent" : "text-ink-tertiary"}`}
                    />
                    <div className="min-w-0">
                      <p className="text-label text-ink">{u.name}</p>
                      <p className="mt-0.5 text-caption text-ink-secondary">
                        {u.pronta
                          ? [u.district, `${u.city}/${u.uf}`].filter(Boolean).join(" · ")
                          : "Sem CEP — não aparece na busca"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.pronta ? (
                      <Badge tone="positive">No mapa</Badge>
                    ) : (
                      <Badge tone="attention">Falta o CEP</Badge>
                    )}
                    <Button variant="ghost" className="h-11 md:h-9" onClick={() => setEditando(u)}>
                      Editar
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
          {estado.unidades.filter((u) => u.active).length === 0 ? (
            <p className="mt-2 text-caption text-ink-secondary">
              Cadastre uma unidade para aparecer no diretório.
            </p>
          ) : null}
        </div>

        {/* Prévia do cartão */}
        {podeAparecer ? (
          <div className="px-4 py-4">
            <p className="text-section">Como você aparece na busca</p>
            <div className="mt-2 max-w-[420px] rounded-card border border-line bg-surface-raised p-4 shadow-card">
              <p className="text-card text-ink">{estado.nome}</p>
              <p className="mt-0.5 text-caption text-ink-secondary">
                {[prontas[0]?.district, `${prontas[0]?.city}/${prontas[0]?.uf}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {bio ? <p className="mt-2 line-clamp-2 text-caption text-ink-secondary">{bio}</p> : null}
              <p className="mt-3 text-label text-ink">
                {estado.servicosPublicados}{" "}
                {estado.servicosPublicados === 1 ? "serviço" : "serviços"}
                {estado.precoMinCents != null ? (
                  <>
                    {" · a partir de "}
                    <span className="tabular">{formatBRL(estado.precoMinCents)}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      {editando ? (
        <BranchSheet
          branch={editando}
          onClose={() => setEditando(null)}
          onSaved={(m) => {
            toast.success(m);
            setEditando(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
