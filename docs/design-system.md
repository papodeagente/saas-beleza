# Design System

**Direção:** dashboard clínico claro e confiável, na linguagem visual da referência aprovada pelo dono do produto — canvas azul-acinzentado, cards brancos de canto largo com sombra suave, barra lateral em gradiente azul→ciano, acento azul e badges pastel.

O produto é usado 8h por dia por recepcionistas. Toda decisão abaixo serve a dois objetivos: **hierarquia** (o que importa se destaca sozinho) e **legibilidade medida** (nenhum par texto/fundo abaixo de 4.5:1 — os números estão anotados).

---

## 1. Cor

| Token | Valor | Uso |
|---|---|---|
| `--color-surface` | `#F4F7FC` | canvas da aplicação |
| `--color-surface-raised` | `#FFFFFF` | card, lista, painel |
| `--color-surface-sunken` | `#F7F9FC` | well, campo desabilitado |
| `--color-ink` | `#1B2559` | texto principal — 13.4:1 |
| `--color-ink-secondary` | `#5A6A85` | todo texto secundário — 5.1:1 |
| `--color-ink-tertiary` | `#626E87` | ícone, placeholder, separador — 4.8:1 |
| `--color-line` | `#E8EDF5` | borda hairline |
| `--color-line-strong` | `#D5DEEB` | borda de campo, divisor forte |
| `--color-accent` | `#2560D6` | ação primária, seleção, link |
| `--color-accent-soft` | `#EAF1FE` | fundo de seleção e badge de acento |
| `--color-brand-from` / `--color-brand-to` | `#3F6BE8` → `#12749A` | gradiente da barra lateral |

Status, sempre em par sólido/soft (todos ≥ 4.7:1):
`positive #0B7A5E / #E6F7F2` · `attention #8A5A07 / #FDF3E2` · `danger #B7333A / #FDEDED` · `info #2560D6 / #EAF1FE`

**Duas correções deliberadas à referência.** O azul dela é mais claro e deixa o texto branco do botão em ~3.9:1; o nosso é escurecido até 5.6:1. O ciano vivo do fim do gradiente deixa o texto branco do pé da barra em 2:1; o nosso ciano profundo mantém 5.2:1. A interpolação linear garante que nenhum ponto intermediário do gradiente fique abaixo de 4.7:1.

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

`Button` (primary azul / secondary contornado azul / ghost / danger; em pílula, com `loading`) · `Input` / `Textarea` / `Field` (erro associado por `aria-describedby`) · `Select` nativo estilizado · `Badge` pastel em pílula · `Avatar` (iniciais com contraste garantido) · `Card` / `CardHeader` / `CardList` / `DataRow` · `Metric` / `MetricRow` (um card por número) · `Sheet` e `Dialog` · `EmptyState` (`size="sm"` para estado rotineiro) · `Skeleton`.

Do shell: `PageHeader` (barra branca, título grande, ações à direita), `PageBody`, `SectionLabel`.

**Faixa lateral de 3px = STATUS**, em toda lista de atendimento e em toda largura (`stripeColor`). Identidade do profissional é ponto de 6px (`ProfessionalDot`), nunca a faixa.

## 5. Acessibilidade

Contraste medido e verificado no navegador em todas as rotas. Alvo de toque de 44px via `pointer-coarse:min-h-11` nos primitivos — o dedo ganha área sem que o mouse perca densidade. Foco visível sempre (ring de 2px no acento). Estado nunca comunicado só por cor. Botão só-ícone exige `aria-label`.

## 6. Copy

Português direto, sentence case, verbos ativos. O botão diz o que acontece ("Agendar") e o toast confirma no mesmo vocabulário ("Agendamento criado"). Um conceito, um nome, em toda a interface. **O produto nunca afirma o que não faz:** não há canal de WhatsApp/e-mail/SMS conectado no envio, então nenhum texto diz que o sistema avisa, lembra ou envia.

## 7. Modo escuro

Adiado. O produto comete-se com um único look claro.
