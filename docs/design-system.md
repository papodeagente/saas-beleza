# Design System

**Direção:** "casa de beleza premium, ferramenta de precisão". A referência de qualidade é Linear/Stripe/Attio (precisão, densidade calma, velocidade), mas a identidade visual vem do mundo do cliente: estética, pele, luz suave, porcelana — não de um template administrativo.

O produto é usado 8h por dia por recepcionistas. Tudo aqui serve a dois objetivos: **calma** (nada grita) e **hierarquia** (o que importa se destaca sozinho).

---

## 1. Identidade

### Paleta

Base de neutros **quentes** (porcelana/greige — nunca cinza azulado de admin), um único acento **bordeaux** (código visual de beleza premium: batom, vinho, mogno) e cores de status dessaturadas.

| Token | Valor | Uso |
|---|---|---|
| `--surface` | `#FAF9F7` | fundo da aplicação (porcelana) |
| `--surface-raised` | `#FFFFFF` | cards, painéis, popovers |
| `--surface-sunken` | `#F3F1EE` | wells, inputs, linhas zebradas |
| `--ink` | `#231F1D` | texto primário (marrom-preto quente) |
| `--ink-secondary` | `#6E6660` | texto secundário |
| `--ink-tertiary` | `#9C948D` | metadata, placeholders |
| `--line` | `#E8E4DF` | bordas hairline |
| `--line-strong` | `#D6D0C9` | bordas de inputs, divisores fortes |
| `--accent` | `#7C2D3E` | bordeaux — ação primária, seleção, links |
| `--accent-hover` | `#68242F` | hover do acento |
| `--accent-soft` | `#F6E9EC` | fundos de seleção/realce do acento |
| `--positive` | `#3D7A50` / soft `#E8F2EB` | sucesso, pago, confirmado |
| `--attention` | `#996A1F` / soft `#F7EEDD` | atenção, pendente |
| `--danger` | `#B03A2E` / soft `#F9E9E7` | erro, cancelado, vencido |
| `--info` | `#3E5F8A` / soft `#E9EFF6` | neutro-informativo (check-in, em andamento) |

Regras de cor:
- Cor **indica** (ação, status, seleção, atenção). Nunca decora.
- Um gráfico/lista sem semântica de status é monocromático.
- O bordeaux aparece em no máximo ~2 pontos por tela (ação primária + seleção).
- Status usa sempre o par sólido/soft (texto sólido sobre fundo soft).

### Tipografia

| Papel | Fonte | Uso |
|---|---|---|
| UI / corpo / dados | **Instrument Sans** (next/font) | tudo por padrão. Números sempre `tabular-nums` |
| Voz do produto | **Fraunces** (opsz auto, peso 500–600) | **apenas**: saudação do "Hoje", títulos de empty state, booking público, login |

A serif é a voz do copiloto falando com o dono — usada com contenção extrema, ela é a assinatura. Se aparecer em toda tela, morreu.

Escala (rem):

| Token | Tamanho/altura | Uso |
|---|---|---|
| `display` | 28/34 Fraunces 550 | saudação do Hoje, público |
| `title` | 17/24 sans 600, tracking -0.01em | título de página (discreto — sistema, não landing) |
| `section` | 13/20 sans 600, uppercase tracking +0.06em, ink-tertiary | rótulo de seção ("PRECISA DA SUA ATENÇÃO") |
| `card-title` | 14/20 sans 600 | títulos de card/painel |
| `body` | 14/20 sans 450 | padrão |
| `label` | 13/16 sans 500 | labels de form, células |
| `caption` | 12/16 sans 450, ink-secondary | apoio |
| `metadata` | 12/16 sans 450, ink-tertiary | timestamps, ids |
| `metric` | 22/28 sans 600 tabular | números operacionais |

Títulos de página são pequenos e firmes. Interface sofisticada, não promocional.

### Espaço, forma, profundidade

- Escala de spacing: 4px base — usar somente `1 2 3 4 5 6 8 10 12 16` (Tailwind). Nada de valores arbitrários.
- Radius: `--radius-sm 6px` (inputs, badges), `--radius 10px` (cards, painéis), `--radius-lg 14px` (modais, drawer). Full para avatar/pill.
- Profundidade: bordas hairline primeiro. Sombra **só** em camadas flutuantes: `--shadow-overlay: 0 8px 24px rgb(35 31 29 / 0.10), 0 2px 8px rgb(35 31 29 / 0.06)`. Cards em página **não** têm sombra.
- Densidade: linhas de lista 44–52px; agenda usa 15min = 14px de altura (h 8h–20h cabe numa tela).
- Containers: conteúdo max-w `1120px` exceto agenda/inbox (full). Padding de página 24/32px.

## 2. Componentes (src/components/ui)

Primitivos próprios no espírito shadcn (cva + tailwind-merge), mas com os tokens acima — nunca o default. Inventário v1:

`Button` (primary bordeaux / secondary outline / ghost / danger; sm 32px, md 36px) · `Input`/`Textarea` (fundo sunken, borda line-strong, focus ring accent 2px) · `Select` nativo estilizado · `Badge` de status (par sólido/soft, radius-sm, 11px 500) · `Avatar` (iniciais sobre accent-soft, nunca imagem quebrada) · `Dialog` e `Sheet` (drawer lateral 400–480px — a casa das interações contextuais da agenda) · `Toast` (sonner, bottom-right, discreto) · `Skeleton` (shimmer sutil em sunken) · `EmptyState` (título Fraunces + 1 frase + 1 ação primária) · `Kbd`.

Padrões de composição:
- **Página** = header fino (título 17px + ação primária à direita) + conteúdo. Sem breadcrumbs em v1, sem hero.
- **Lista** = linhas com hairline entre elas, hover `surface-sunken`, sem card por item. Card só quando agrupa conceito, nunca como decoração.
- **Painel contextual (Sheet)** é o padrão de interação: clicar em qualquer entidade abre painel lateral com contexto + ações. Página cheia só para o Customer 360.

## 3. Motion

- Durações: 120ms (hover/press), 180ms (popover/toast), 240ms (sheet/dialog). Easing `cubic-bezier(0.32, 0.72, 0, 1)`.
- Anima-se: entrada de overlay (fade+slide 8px), mudança de status (crossfade do badge), confirmações.
- Nunca: animação decorativa, spinner de tela cheia, layout shift.
- `prefers-reduced-motion`: tudo vira fade simples.

## 4. Estados obrigatórios

Toda feature entrega os quatro:
- **Empty**: título Fraunces + orientação + ação ("Sua agenda ainda está vazia. Cadastre serviços e profissionais para receber agendamentos. [Configurar catálogo]"). Nunca "Nenhum registro encontrado".
- **Loading**: skeleton com a silhueta real do conteúdo. Optimistic update onde seguro (status de atendimento, confirmação).
- **Error**: o que houve + impacto + como resolver, na voz do produto. Nunca "Erro 500".
- **Interação**: hover, focus visível (ring accent), active, disabled — definidos nos primitivos, herdados por todos.

## 5. Acessibilidade

Contraste AA no mínimo (ink sobre surface = 13:1; accent sobre branco = 8,2:1). Foco visível sempre. Targets ≥40px em superfícies touch. Labels reais em todo input (nunca placeholder-como-label). Radix para overlays (foco/aria corretos).

## 6. Copy

Português direto, sentence case, verbos ativos. Botão diz o que acontece ("Agendar", "Registrar pagamento") e o toast confirma no mesmo vocabulário ("Agendamento criado"). O sistema fala como um colega competente: sem jargão técnico, sem exclamações, sem "Ops!". Erros não pedem desculpa — explicam e apontam a saída.

## 7. Dark mode

Adiado deliberadamente (registro em product-architecture §12). O v1 comete-se com um único look claro impecável; o body pinta `--surface` explicitamente.
