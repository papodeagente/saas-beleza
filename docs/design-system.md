# Design System

**Direção:** produto claro, acolhedor e sofisticado — canvas lavanda quase branco, cards brancos de canto largo, superfícies de marca em gradiente roxo e badges pastel. A cor transmite criatividade sem tornar a interface feminina de forma estereotipada.

O produto é usado 8h por dia por recepcionistas. Toda decisão abaixo serve a dois objetivos: **hierarquia** (o que importa se destaca sozinho) e **legibilidade medida** (nenhum par texto/fundo abaixo de 4.5:1 — os números estão anotados).

---

## 1. Cor

| Token | Valor | Uso |
|---|---|---|
| `--color-surface` | `#F8F6FB` | canvas da aplicação |
| `--color-surface-raised` | `#FFFFFF` | card, lista, painel |
| `--color-surface-sunken` | `#F7F9FC` | well, campo desabilitado |
| `--color-ink` | `#2D203B` | texto principal |
| `--color-ink-secondary` | `#675A73` | todo texto secundário |
| `--color-ink-tertiary` | `#766A80` | ícone, placeholder, separador |
| `--color-line` | `#ECE6F1` | borda hairline |
| `--color-line-strong` | `#D9CFE2` | borda de campo, divisor forte |
| `--color-accent` | `#7437B7` | ação primária, seleção, link |
| `--color-accent-soft` | `#F1E8FA` | fundo de seleção e badge de acento |
| `--color-brand-from` / `--color-brand-to` | `#8744CD` → `#622A9F` | gradiente de marca |

Status, sempre em par sólido/soft (todos ≥ 4.7:1):
`positive #0B7A5E / #E6F7F2` · `attention #8A5A07 / #FDF3E2` · `danger #B7333A / #FDEDED` · `info #2560D6 / #EAF1FE`

**Correção deliberada à referência.** Os roxos da imagem orientam a identidade; ações pequenas usam uma leitura mais profunda para garantir contraste AA com texto branco.

Cor **indica** (ação, status, seleção, atenção), nunca decora. Gráfico sem semântica de status é monocromático. Cor de identidade cadastrada (profissional) passa por `identityTint` de `src/lib/color.ts`, que escurece o texto só o necessário para cruzar 4.5:1 — cor livre não tem garantia de contraste.

## 2. Tipografia

**Plus Jakarta Sans**, uma família só. A escala vive em tokens e **`text-[Npx]` é proibido**:

| utility | tamanho/peso | uso |
|---|---|---|
| `text-display` | 26/34 700 | saudação do "Hoje", títulos do booking público |
| `text-entity` | 22/30 700 | nome de entidade (ficha do cliente), empty state |
| `text-title` | 20/28 700 | título de módulo (PageHeader) |
| `text-metric` | 24/30 700 tabular | número operacional |
| `text-card` | 16/22 600 | título de card |
| `text-body` | 14/20 400 | padrão |
| `text-label` | 13/18 500 | rótulo de form, célula de lista |
| `text-caption` | 12/16 400 | apoio |
| `text-meta` | 11/16 400 | timestamp, contagem |
| `text-section` | 12/16 600 caixa alta, tracking .06em | rótulo de seção |

Números que se alinham em coluna usam `tabular`.

**Armadilha:** utility nova no namespace `text-*` precisa ser registrada no grupo `font-size` do `extendTailwindMerge` em `src/lib/utils.ts`, no mesmo commit. Sem isso o tailwind-merge a trata como cor e descarta silenciosamente a cor que vier junto — foi o que fez o botão primário renderizar texto escuro sobre azul.

## 3. Forma, profundidade e espaço

- Raio: `rounded-control` 8px (campo), `rounded-pill` (botão, badge, chip, item de nav), `rounded-card` 16px, `rounded-overlay` 20px.
- Card em página tem `--shadow-card` (`0 2px 10px rgb(27 37 89/.05)`) — sombra suave, nunca pesada. Overlay usa `--shadow-overlay`; elemento aderente sobre conteúdo que rola usa `--shadow-sticky`.
- Spacing na escala de 4px (`1 2 3 4 5 6 8 10 12 16`). Nada de valor arbitrário.
- Corpo da página ancorado à esquerda: `PageBody` = `max-w-[1180px]`, `px-5 md:px-8`, sem `mx-auto`. A barra lateral já é a margem esquerda.
- Densidade: linha de lista com `min-h-[52px]`; agenda com 15min = 14px.

## 4. Componentes (`src/components/ui`)

`Button` (primary roxo / secondary contornado / ghost / danger; em pílula, com `loading`) · `Input` / `Textarea` / `Field` (erro associado por `aria-describedby`) · `Select` nativo estilizado · `Badge` pastel em pílula · `Avatar` (iniciais com contraste garantido) · `Card` / `CardHeader` / `CardList` / `DataRow` · `Metric` / `MetricRow` (um card por número) · `Sheet` e `Dialog` · `EmptyState` (`size="sm"` para estado rotineiro) · `Skeleton`.

Do shell: `PageHeader` (barra branca, título grande, ações à direita), `PageBody`, `SectionLabel`.

**Faixa lateral de 3px = STATUS**, em toda lista de atendimento e em toda largura (`stripeColor`). Identidade do profissional é ponto de 6px (`ProfessionalDot`), nunca a faixa.

## 5. Acessibilidade

Contraste medido e verificado no navegador em todas as rotas. Alvo de toque de 44px via `pointer-coarse:min-h-11` nos primitivos — o dedo ganha área sem que o mouse perca densidade. Foco visível sempre (ring de 2px no acento). Estado nunca comunicado só por cor. Botão só-ícone exige `aria-label`.

## 6. Copy

Português direto, sentence case, verbos ativos. O botão diz o que acontece ("Agendar") e o toast confirma no mesmo vocabulário ("Agendamento criado"). Um conceito, um nome, em toda a interface. **O produto nunca afirma o que não faz** — e a regra vale nos dois sentidos: quando o WhatsApp passou a enviar de verdade pela uazapi, a frase que dizia o contrário virou mentira e teve de sair. Texto que descreve capacidade envelhece; revise-o junto com o código.

## 7. Modo escuro

O **produto** é claro, e continua sendo: uma ferramenta de oito horas sob a luz de uma clínica não pede fundo escuro.

A **landing pública** (`src/app/(marketing)`) é escura, e a decisão é de contexto, não de gosto: são noventa segundos de atenção disputada, muitas vezes no celular à noite, e as capturas do produto — que são claras — só têm presença sobre fundo escuro.

As duas convivem sem conflito por causa de uma regra única: **a landing só adiciona nomes de token, nunca redefine os existentes.**

| | Produto | Landing |
|---|---|---|
| Chão | `--color-surface` `#f8f6fb` | `--color-night` `#160e20` |
| Texto | `--color-ink` `#2d203b` | `--color-night-ink` `#faf7fd` |
| Roxo de texto | `--color-accent` `#7437b7` | `--color-accent-lift` `#cda8f0` |

O roxo-noite é derivado do `ink` do produto, então as duas superfícies são a mesma marca em dois horários. Em fundo escuro, use `--color-accent-lift` para texto e ícones.

Três regras escopadas por `[data-surface="night"]` vivem em `globals.css` **dentro de `@layer base`** (fora dela venceriam as utilities do Tailwind): o chão via `body:has()`, a cor das bordas e o anel de foco. `src/lib/design-tokens.test.ts` falha se alguém redefinir um token do produto sob escopo ou esquecer de registrar uma escala nova no tailwind-merge.
