import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, CircleDashed, Inbox, KeyRound, TriangleAlert } from "lucide-react";
import { headers } from "next/headers";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePlatformAdmin } from "@/server/platform-auth";
import {
  HOTMART_EVENT_MAP,
  HOTMART_WEBHOOK_PATH,
  KIND_WITH_WEBHOOK,
  PROVIDER_KINDS,
  PROVIDER_LABELS,
  listPaymentProviders,
  listWebhookEvents,
} from "@/server/services/hotmart";
import { type KindOption, ProviderEditor, WebhookUrlBox } from "./provider-form";

export const metadata = { title: "Pagamentos" };
export const dynamic = "force-dynamic";

const dateTime = (value: Date) => format(value, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

export default async function PaymentsPage() {
  const ctx = await requirePlatformAdmin();

  const [providers, events] = await Promise.all([
    listPaymentProviders(ctx),
    listWebhookEvents(ctx, 20),
  ]);

  // O endereço do webhook precisa ser o que o mundo externo enxerga. Sem
  // APP_URL, o host do próprio pedido é a melhor aproximação — e é o que a
  // pessoa vai colar no painel da Hotmart, então é melhor mostrar algo
  // copiável com o aviso do que mostrar um caminho pela metade.
  const configuredBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(
    /\/+$/,
    "",
  );
  let origin = configuredBase;
  if (!origin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http";
    origin = host ? `${proto}://${host}` : "";
  }
  const webhookUrl = `${origin}${HOTMART_WEBHOOK_PATH}`;

  const registered = new Set(providers.map((provider) => provider.kind));
  const kindOptions: KindOption[] = PROVIDER_KINDS.filter((kind) => !registered.has(kind)).map(
    (kind) => ({
      value: kind,
      label: PROVIDER_LABELS[kind],
      usesWebhook: KIND_WITH_WEBHOOK.includes(kind),
    }),
  );

  const hotmart = providers.find((provider) => provider.kind === "hotmart") ?? null;
  const hotmartPronto = Boolean(hotmart?.enabled && hotmart.hasWebhookToken);

  return (
    <div>
      <PlatformHeader
        title="Pagamentos"
        description="Provedores de cobrança e o que eles entregam por webhook"
        actions={
          kindOptions.length > 0 ? (
            <ProviderEditor kindOptions={kindOptions} label="Novo provedor" variant="primary" />
          ) : null
        }
      />

      <PlatformBody className="space-y-8">
        {/* Provedores */}
        <section>
          <h2 className="text-section">Provedores</h2>
          <Card className="mt-3">
            {providers.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                size="sm"
                title="Nenhum provedor cadastrado"
                description="Cadastre o provedor que cobra as assinaturas para começar a receber os eventos de cobrança."
              />
            ) : (
              <CardList>
                {providers.map((provider) => {
                  const usesWebhook = KIND_WITH_WEBHOOK.includes(provider.kind);
                  return (
                    <li
                      key={provider.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-card text-ink">{provider.name}</span>
                          {/* O tipo só vira etiqueta quando o nome já não o diz. */}
                          {provider.name.trim().toLowerCase() ===
                          PROVIDER_LABELS[provider.kind].toLowerCase() ? null : (
                            <Badge>{PROVIDER_LABELS[provider.kind]}</Badge>
                          )}
                          <Badge tone={provider.enabled ? "positive" : "neutral"}>
                            {provider.enabled ? "Ligado" : "Desligado"}
                          </Badge>
                          {usesWebhook ? (
                            provider.hasWebhookToken ? (
                              <Badge tone="info">
                                <KeyRound className="size-3" aria-hidden />
                                Token {provider.webhookTokenHint ?? "••••"}
                              </Badge>
                            ) : (
                              <Badge tone="attention">
                                <TriangleAlert className="size-3" aria-hidden />
                                Sem token
                              </Badge>
                            )
                          ) : null}
                        </div>
                        <p className="mt-1 text-caption text-ink-secondary">
                          {provider.lastEventAt
                            ? `Último evento recebido em ${dateTime(provider.lastEventAt)}.`
                            : usesWebhook
                              ? "Nenhum evento recebido até agora."
                              : "Não recebe webhook: os lançamentos entram à mão."}
                          {provider.note ? ` ${provider.note}` : ""}
                        </p>
                      </div>

                      <ProviderEditor
                        label="Editar"
                        kindOptions={[
                          {
                            value: provider.kind,
                            label: PROVIDER_LABELS[provider.kind],
                            usesWebhook,
                          },
                        ]}
                        provider={{
                          kind: provider.kind,
                          name: provider.name,
                          enabled: provider.enabled,
                          hasWebhookToken: provider.hasWebhookToken,
                          webhookTokenHint: provider.webhookTokenHint,
                          usesWebhook,
                        }}
                      />
                    </li>
                  );
                })}
              </CardList>
            )}
          </Card>
        </section>

        {/* Webhook da Hotmart */}
        <section>
          <h2 className="text-section">Webhook da Hotmart</h2>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <Card className="space-y-3 px-5 py-4">
              <p className="text-body text-ink-secondary">
                No painel da Hotmart, abra o produto, vá em Ferramentas → Webhook e cole este
                endereço. O token que a Hotmart mostrar (o <em>hottok</em>) precisa ser salvo no
                provedor acima — é ele que autentica cada entrega.
              </p>

              <WebhookUrlBox url={webhookUrl} appUrlConfigured={Boolean(configuredBase)} />

              <p className="flex items-start gap-1.5 text-caption">
                {hotmartPronto ? (
                  <>
                    <CheckCircle2 className="mt-px size-3.5 shrink-0 text-positive" aria-hidden />
                    <span className="text-positive">
                      Provedor ligado e com token salvo: as entregas da Hotmart são aceitas e
                      registradas.
                    </span>
                  </>
                ) : (
                  <>
                    <TriangleAlert className="mt-px size-3.5 shrink-0 text-attention" aria-hidden />
                    <span className="text-attention">
                      {hotmart?.hasWebhookToken
                        ? "O token está salvo, mas o provedor está desligado: toda entrega é recusada com 401."
                        : "Sem o token salvo, toda entrega é recusada com 401 — por isso ainda não chegou evento nenhum."}
                    </span>
                  </>
                )}
              </p>

              <div className="rounded-control bg-attention-soft px-3 py-2.5">
                <p className="text-caption font-semibold text-attention">
                  Falta decidir: qual produto da Hotmart é qual plano daqui.
                </p>
                <p className="mt-1 text-caption text-attention">
                  Enquanto esse mapa não existir, o evento é recebido, autenticado e guardado
                  inteiro, mas a assinatura NÃO é criada nem alterada — inventar uma viraria receita
                  fantasma no gráfico de MRR. Cada evento fica marcado como não processado com o
                  motivo, e dá para reprocessar quando o mapa chegar.
                </p>
              </div>
            </Card>

            <Card className="px-5 py-4">
              <p className="text-section">Eventos reconhecidos</p>
              <dl className="mt-2 space-y-2.5">
                {Object.entries(HOTMART_EVENT_MAP).map(([name, mapped]) => (
                  <div key={name}>
                    <dt className="font-mono text-caption text-ink">{name}</dt>
                    <dd className="text-caption leading-4 text-ink-secondary">
                      {mapped.description}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-meta text-ink-tertiary">
                Qualquer outro evento continua sendo guardado, marcado como não tratado.
              </p>
            </Card>
          </div>
        </section>

        {/* Entregas */}
        <section>
          <h2 className="text-section">Últimos eventos recebidos</h2>
          <Card className="mt-3">
            {events.length === 0 ? (
              <EmptyState
                icon={Inbox}
                size="sm"
                title="Nada chegou até agora"
                description={
                  hotmartPronto
                    ? "O provedor está ligado e com token salvo. Assim que a Hotmart entregar o primeiro evento, ele aparece aqui com o payload guardado."
                    : "Nenhuma entrega foi registrada porque o token do webhook ainda não está configurado: sem ele, a Hotmart recebe 401 e nada é gravado."
                }
              />
            ) : (
              <CardList>
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-label text-ink">
                          {event.eventName ?? "Evento sem nome"}
                        </span>
                        <Badge>{PROVIDER_LABELS[event.kind]}</Badge>
                        {event.processedAt ? (
                          <Badge tone="positive">
                            <CheckCircle2 className="size-3" aria-hidden />
                            Processado
                          </Badge>
                        ) : (
                          <Badge tone="attention">
                            <CircleDashed className="size-3" aria-hidden />
                            Não processado
                          </Badge>
                        )}
                      </div>
                      {event.error ? (
                        <p className="mt-1 max-w-[70ch] text-caption text-ink-secondary">
                          {event.error}
                        </p>
                      ) : null}
                      {event.externalId ? (
                        <p className="mt-0.5 truncate font-mono text-meta text-ink-tertiary">
                          {event.externalId}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 tabular text-caption text-ink-secondary">
                      {dateTime(event.receivedAt)}
                    </span>
                  </li>
                ))}
              </CardList>
            )}
          </Card>
        </section>
      </PlatformBody>
    </div>
  );
}
