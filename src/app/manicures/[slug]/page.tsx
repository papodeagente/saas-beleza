import { ArrowLeft, AtSign, CalendarCheck, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { getPublicOrganization } from "@/server/services/public-booking-service";
import { perfilPublico } from "@/server/services/marketplace-service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const perfil = await perfilPublico((await params).slug);
  if (!perfil) return { title: "Salão não encontrado" };
  const onde = perfil.unidades[0];
  return {
    title: `${perfil.nome}${onde?.cidade ? ` — ${onde.cidade}/${onde.uf}` : ""}`,
    description:
      perfil.bio ??
      `Agende seu horário com ${perfil.nome}${onde?.cidade ? ` em ${onde.cidade}` : ""}.`,
  };
}

export default async function PerfilPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /**
   * Duas leituras, e as duas precisam concordar.
   *
   * `perfilPublico` responde "esta conta está no diretório"; `getPublicOrganization`
   * responde "esta conta pode receber marcação" e já carrega o portão comercial.
   * Um salão que aparecesse aqui sem poder agendar seria uma vitrine com a porta
   * trancada.
   */
  const [perfil, agenda] = await Promise.all([
    perfilPublico(slug),
    getPublicOrganization(slug),
  ]);
  if (!perfil || !agenda) notFound();

  const zap = perfil.whatsapp?.replace(/\D/g, "");
  const servicos = agenda.services;
  const precoMin = servicos.length ? Math.min(...servicos.map((s) => s.priceCents)) : null;

  return (
    <main data-surface="cartao" className="grao relative isolate min-h-dvh bg-balcao">
      <div className="mx-auto w-full max-w-[760px] px-5 pb-24 sm:px-8">
        <div className="pt-6">
          <Link
            href="/manicures"
            className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-label text-ink-secondary transition-colors hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Todas as manicures
          </Link>
        </div>

        <header className="mt-2">
          <h1 className="font-brand text-fachada text-ink">{perfil.nome}</h1>
          {perfil.unidades[0]?.cidade ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-body text-ink-secondary">
              <MapPin aria-hidden className="size-4 shrink-0 text-ink-tertiary" />
              {[perfil.unidades[0].bairro, `${perfil.unidades[0].cidade}/${perfil.unidades[0].uf}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {perfil.bio ? (
            <p className="mt-4 max-w-prose text-body text-ink">{perfil.bio}</p>
          ) : null}
        </header>

        {/* A ação principal. Fica cedo na página: quem chegou pelo diretório
            veio para marcar, não para ler. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" asChild>
            <Link href={`/agendar/${perfil.slug}`}>
              <CalendarCheck aria-hidden />
              Ver horários e agendar
            </Link>
          </Button>
          {zap ? (
            <Button variant="secondary" size="lg" asChild>
              <a
                href={`https://wa.me/${zap.length > 11 ? zap : `55${zap}`}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle aria-hidden />
                WhatsApp
              </a>
            </Button>
          ) : null}
          {perfil.instagram ? (
            <Button variant="ghost" size="lg" asChild>
              <a
                href={`https://instagram.com/${perfil.instagram}`}
                target="_blank"
                rel="noreferrer"
              >
                <AtSign aria-hidden />
                {perfil.instagram}
              </a>
            </Button>
          ) : null}
        </div>

        {/* A carta de serviços — o que ela faz e por quanto */}
        {servicos.length > 0 ? (
          <section className="mt-10" aria-labelledby="servicos">
            <h2 id="servicos" className="text-section">
              <span>
                Serviços
                {precoMin != null ? (
                  <>
                    {" · a partir de "}
                    <span className="tabular">{formatBRL(precoMin)}</span>
                  </>
                ) : null}
              </span>
            </h2>
            <ul className="mt-2.5 overflow-hidden rounded-card border border-[var(--color-cartao-linha)] bg-cartao shadow-card">
              {servicos.map((servico, i) => (
                <li
                  key={servico.id}
                  className={i > 0 ? "border-t border-[var(--color-cartao-linha)]" : undefined}
                >
                  <div className="flex items-start gap-4 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-card text-ink">{servico.name}</p>
                      {servico.description ? (
                        <p className="mt-0.5 line-clamp-2 text-caption text-ink-secondary">
                          {servico.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-caption text-ink-secondary">
                        {servico.durationMin} min
                      </p>
                    </div>
                    <span className="shrink-0 text-card tabular text-ink">
                      {formatBRL(servico.priceCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Onde fica */}
        {perfil.unidades.length > 0 ? (
          <section className="mt-10" aria-labelledby="onde">
            <h2 id="onde" className="text-section">
              <span>Onde fica</span>
            </h2>
            <ul className="mt-2.5 space-y-2">
              {perfil.unidades.map((u) => (
                <li
                  key={u.id}
                  className="rounded-card border border-[var(--color-cartao-linha)] bg-cartao px-4 py-3.5"
                >
                  <p className="text-label text-ink">{u.nome}</p>
                  {u.endereco ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.endereco)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-caption text-ink-secondary underline-offset-4 hover:text-accent hover:underline"
                    >
                      <MapPin aria-hidden className="size-3.5 shrink-0 text-ink-tertiary" />
                      {u.endereco}
                    </a>
                  ) : null}
                  {u.telefone ? (
                    <a
                      href={`tel:+55${u.telefone.replace(/\D/g, "")}`}
                      className="mt-1 flex min-h-11 items-center gap-1.5 text-caption text-ink-secondary hover:text-accent"
                    >
                      <Phone aria-hidden className="size-3.5 shrink-0 text-ink-tertiary" />
                      {formatPhone(u.telefone)}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="mt-16 flex items-center gap-2 border-t border-[var(--color-cartao-linha)] pt-6">
          <BrandLogo compact className="opacity-55 [&_img]:h-6" />
          <span className="text-meta text-ink-secondary">agendamento online</span>
        </footer>
      </div>
    </main>
  );
}
