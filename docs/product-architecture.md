# Arquitetura do Produto

**Working title:** Lumina OS (nome provisório — o seed usa "Clínica Lumina" como tenant fictício)
**Segmento:** negócios locais de estética (clínicas, studios, spas)
**Ambição:** o sistema operacional do negócio de estética — não uma agenda, não um CRM, não um chatbot. Um produto único onde conversa vira receita e receita vira retenção.

---

## 1. Visão

O coração do produto é um ciclo, não uma lista de módulos:

```
WhatsApp → IA → Cliente → Agenda → Atendimento → Pagamento → Financeiro → Retenção → Novo atendimento
```

Todo módulo existe para fortalecer esse ciclo. Módulos compartilham contexto: a conversa conhece a agenda, a agenda conhece o financeiro, o financeiro conhece o cliente, e a camada de inteligência observa tudo.

Evolução planejada:

1. **System of Record** — registrar a operação com fidelidade (fases 1–4).
2. **System of Intelligence** — entender, priorizar e recomendar (fases 5–8).
3. **System of Action** — executar parte da operação (IA agenda, IA recupera clientes).

## 2. Princípios

- **Uma boa decisão automática > uma configuração a mais.** O sistema infere unidade, duração, preço, comissão. Só pergunta o que não pode saber.
- **Zero troca de contexto.** Toda pergunta que um atendente recebe no Inbox deve ser respondível sem sair do Inbox.
- **Insight → ação.** Nenhuma métrica sem próximo passo possível.
- **Uma única fonte de verdade por conceito.** Disponibilidade é calculada em um único lugar (`AvailabilityService`) para admin, página pública, WhatsApp e IA.
- **A IA nunca inventa.** Preço, horário, serviço e política vêm de tools; sem dado, ela transfere.
- **Profundidade antes de quantidade.** Uma agenda extraordinária vale mais que cinco módulos superficiais.

## 3. Stack

Decidida em 2026-08-22 (projeto greenfield; preferências do Bruno respeitadas — PostgreSQL puro no Coolify, **sem Supabase**):

| Camada | Escolha | Racional |
|---|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript | full-stack único, RSC para leitura rápida, Server Actions para mutação |
| Banco | PostgreSQL 16 (Coolify, `saas-agendamento-db`) | já provisionado; constraints fortes (EXCLUDE) para booking |
| ORM | Drizzle + node-postgres | SQL explícito, migrations versionadas, tipos de ponta a ponta |
| Validação | Zod | schema compartilhado entre server actions e forms |
| UI | Tailwind v4 + primitivos próprios (estilo shadcn, customizados) | identidade própria; ver `design-system.md` |
| Datas | date-fns + date-fns-tz | timezone do tenant centralizado em `src/lib/tz.ts` |
| Testes | Vitest | unit no domínio (availability) + integração no booking |
| Jobs/filas | (fase 4+) BullMQ + Redis no Coolify | necessário para mensageria/automations; não instalar antes |

Gerenciador de pacotes: **pnpm** (padrão do Bruno).

## 4. Domínio

### 4.1 Hierarquia de tenant

```
Organization (tenant, timezone America/Sao_Paulo)
 └── Branch (unidade física)
      ├── Professional (nem todo profissional tem login)
      ├── Resource (room | cabin | equipment)
      └── Operações (appointments, payments, conversations…)
User ─ OrganizationMember ─ Organization   (login ≠ profissional)
Customer pertence à Organization (não à Branch — cliente circula entre unidades)
```

### 4.2 Entidades núcleo (implementadas na fase 1–2)

- `organizations` — tenant. `slug` (único, usado em /agendar/{slug}), `timezone`.
- `branches` — unidade. Horário de funcionamento fica no profissional, não na unidade (v1).
- `users` / `sessions` / `organization_members` — auth por e-mail+senha, sessão em cookie httpOnly com hash em banco. `role`: owner | admin | staff | professional.
- `professionals` — entidade separada de user (`user_id` opcional). Especialidades, cor na agenda, comissão default (`commission_bps`).
- `professional_services` — join com override opcional de comissão/preço/duração.
- `professional_working_hours` — grade semanal por profissional+unidade (weekday, start, end).
- `schedule_blocks` — bloqueios/férias por profissional (range absoluto).
- `service_categories` / `services` — duração, buffers (antes/depois), preço e custo em **centavos**, antecedência mínima/máxima de booking online, flag `online_booking`.
- `resources` + `service_resources` — sala/cabine/equipamento exigidos por serviço.
- `customers` — perfil 360: origem (`source`: manual | whatsapp | public_booking | ai | import), consentimentos, agregados desnormalizados (`total_spent_cents`, `visits_count`, `last_visit_at`, `no_show_count`) mantidos pelos serviços de domínio.
- `customer_tags` + `customer_tag_links`.
- `appointments` — o registro operacional central. Ver ciclo de vida em 4.3.
- `appointment_history` — auditoria: actor (user | ai | automation | public | system), before/after JSON.
- `payments` — N pagamentos por atendimento (método, valor em centavos). Cada payment gera uma `financial_transactions` de income.
- `financial_transactions` — income | expense; pending | paid | overdue | cancelled. Gerencial, não contábil.
- `commissions` — **persistida** no completed do atendimento (nunca só cálculo retroativo).
- `domain_events` — outbox de eventos (`appointment.created`, `payment.received`…). Fase 1: gravado; fase 4+: consumido por worker.
- `conversations` / `messages` / `ai_agents` — modeladas desde já (o dado conversacional nasce estruturado para responder "quantas conversas viraram agendamento"), UI na fase 4–5.

### 4.3 Ciclo de vida do atendimento

```
scheduled → confirmed → checked_in → in_progress → completed
     └────────┬────────────┘
          cancelled | no_show
```

- Transições válidas são enforçadas no `AppointmentService` (não na UI).
- `completed` dispara: agregados do cliente, transação financeira dos payments pendentes, persistência da comissão, evento `appointment.completed`.
- `cancelled`/`no_show` liberam o slot (o EXCLUDE constraint só cobre status ativos).

### 4.4 Dinheiro e tempo

- Dinheiro: **inteiro em centavos** em todas as tabelas. Formatação apenas na borda da UI (`formatBRL`).
- Tempo: tudo `timestamptz` (UTC) no banco. Conversão para o fuso do tenant **somente** em `src/lib/tz.ts`. Horários de grade (working hours) são `time` local do tenant por definição.

## 5. Multi-tenancy (regra inegociável)

- Toda tabela de dados de tenant tem `organization_id NOT NULL` + índice.
- **Todo acesso a dados passa pela camada de serviço**, que recebe um `TenantContext { organizationId, userId, role }` derivado da sessão — nunca do client.
- Server Actions e route handlers obtêm o contexto via `requireSession()`; um `organizationId` vindo de payload é ignorado.
- IDOR: buscas por id sempre incluem `AND organization_id = $ctx`. Um registro de outro tenant se comporta como inexistente (404), nunca como proibido (403).
- Testes de tenancy são prioridade máxima (ver §9).
- **RLS**: planejada como segunda camada (defense in depth) na fase de hardening — exigirá `SET app.org_id` por transação. Documentado para não bloquear a fase 1.

## 6. AvailabilityService — fonte única de disponibilidade

```
computeAvailableSlots(input) — função PURA, unit-testada
  ├─ grade: working hours do profissional na unidade, no fuso do tenant
  ├─ subtrai: appointments ativos (com buffers do serviço aplicados dos dois lados)
  ├─ subtrai: schedule_blocks
  ├─ subtrai: conflitos de resource (sala/equipamento)
  ├─ aplica: antecedência mínima/máxima, granularidade de slot (15min)
  └─ retorna slots { start, end, professionalId, resourceId? }

AvailabilityService (I/O)
  └─ carrega dados e delega à função pura. Consumido por: agenda admin,
     página pública, tools da IA, API. NUNCA duplicar essa lógica.
```

**Anti-double-booking em três camadas:**
1. UI mostra apenas slots calculados;
2. `AppointmentService.create` revalida dentro de transação;
3. Constraint `EXCLUDE USING gist` no Postgres sobre `(professional_id, tstzrange(starts_at, ends_at))` (e `resource_id`) para status ativos — a garantia final é do banco, imune a race conditions.

## 7. Mensageria e IA (arquitetura, implementação fases 4–5)

- `MessagingProvider` é uma interface (`sendMessage`, `webhook parsing`) — WhatsApp é a primeira implementação, nunca um acoplamento.
- `conversations.controlled_by`: `ai | human | waiting`. Humano assumiu ⇒ IA silencia; devolução à IA é explícita.
- O agente de IA opera **exclusivamente via tools** (`getAvailableSlots`, `createAppointment`, `findCustomer`…) que chamam os mesmos serviços de domínio do admin, com `actor = 'ai'` na auditoria. Toda execução logada em `ai_execution_logs`.
- Regra de confiabilidade: sem tool, sem afirmação. Sem dado, transferir (`transferToHuman`).
- Atribuição de receita: `appointments.source` (`admin | public | whatsapp | ai`) + `conversation_id` opcional ⇒ responde "quanta receita nasceu no WhatsApp/IA".

## 8. Eventos e automações

- Serviços de domínio gravam em `domain_events` (outbox) na mesma transação da mutação.
- Fase 1–3: eventos alimentam auditoria e a home "Hoje".
- Fase 4+: worker (BullMQ) consome o outbox ⇒ automations, lembretes, campanhas de retenção.
- Sinais de retenção (fase 7) derivam de dados que já nascem estruturados: `services.return_interval_days` (período ideal de retorno), `customers.last_visit_at`, agregados de frequência.

## 9. Testes críticos (ordem de prioridade)

1. **Tenancy** — serviço com ctx do tenant A jamais lê/escreve tenant B.
2. **Availability** — conflitos, buffers, bloqueios, antecedência, resources (unit, função pura).
3. **Booking** — double booking barrado pelo constraint (integração, 2 escritas concorrentes).
4. **Financeiro** — soma de payments, comissão persistida.
5. **IA** — autorização e execução de tools (fase 5).

## 10. Navegação

```
Hoje | Agenda | Clientes | Inbox | Financeiro | Catálogo | Gestão
```

"Hoje" é a central de comando (briefing matinal + atenção + próximos atendimentos + inteligência), não um dashboard de gráficos. Progressive disclosure em tudo.

## 11. Roadmap

| Fase | Entrega | Estado |
|---|---|---|
| 0 | Arquitetura, design system, modelo de domínio | ✅ |
| 1 | Fundação: auth, tenant, shell, tokens, schema, seed | ✅ |
| 2 | Core: clientes, profissionais, serviços, availability, agenda, ciclo do atendimento | ✅ |
| 3 | Booking público `/agendar/{slug}` | ✅ |
| 4 | Inbox (conversations, assignment, contexto do cliente) | 🟡 UI e handoff prontos; falta o `MessagingProvider` (envio/recebimento real) |
| 5 | Agente de IA (tools, knowledge, handoff, logs) | ⬜ tabelas modeladas, sem runtime |
| 6 | Financeiro (caixa, DRE gerencial, comissões) | 🟡 leitura completa; falta lançar despesa/receita pela UI |
| 7 | Retenção (sinais, campanhas, recuperação) | 🟡 sinal de retorno já aparece em Hoje e Clientes; falta campanha |
| 8 | Inteligência (insights acionáveis, benchmarks, ações assistidas) | ⬜ |

### O que existe hoje, por tela

| Rota | Entrega |
|---|---|
| `/entrar` | Login por e-mail e senha, sessão em banco |
| `/hoje` | Briefing do dia, fila de atenção acionável, próximos atendimentos, sinal de retorno |
| `/agenda` | Dia por profissional, linha do agora, painel contextual (confirmar → check-in → iniciar → concluir), pagamento, cancelamento/falta, agendamento rápido |
| `/clientes` | Lista com busca e filtros no servidor (retorno, novos, inativos) |
| `/clientes/[id]` | Customer 360 com timeline única de atendimentos e pagamentos |
| `/inbox` | Conversas, thread, contexto do cliente, handoff IA ↔ humano |
| `/financeiro` | Caixa do mês, DRE gerencial, receita por serviço, comissões, lançamentos |
| `/catalogo` | Serviços com duração, preço, margem, recursos e profissionais |
| `/gestao` | Link público, profissionais e grade, unidades e recursos, acessos |
| `/agendar/[slug]` | Booking público mobile-first, sem conta |

### Dívidas conhecidas (registradas, não escondidas)

1. **`MessagingProvider` não existe** — o Inbox registra a mensagem na conversa, mas nada sai para o WhatsApp. A UI diz isso explicitamente em vez de fingir entrega.
2. **RLS ainda não aplicada** — o isolamento hoje é garantido pela camada de serviço + `organization_id` em toda query, coberto por testes. RLS entra como segunda barreira.
3. **Financeiro é somente leitura na UI** — lançamentos nascem dos pagamentos; criar despesa manual ainda não tem tela.
4. **Sem drag & drop na agenda** — remarcar existe pelo domínio (`rescheduleAppointment`), falta a interação.
5. **Booking público não sinaliza dias sem vaga** nos chips de data (exigiria pré-cálculo de 14 dias).
6. **Onboarding não existe** — um tenant novo cai numa aplicação vazia; hoje só o seed cria uma clínica completa.
7. **Command palette (⌘K) não implementado.**

**Nota de priorização:** WhatsApp + IA (fases 4–5) vêm antes de administrativo secundário (estoque, relatórios avançados). O diferencial é transformar conversa em receita.

## 12. Decisões registradas (ADR resumido)

- **Sem Supabase** — preferência explícita do owner; Postgres puro no Coolify. Auth própria (sessões em banco).
- **Centavos como inteiro** — nunca float para dinheiro.
- **Professional ≠ User** — nem todo profissional loga.
- **Customer é da Organization**, não da Branch.
- **EXCLUDE constraint** é a autoridade final anti-double-booking.
- **Outbox pattern** para eventos desde o dia 1, worker só quando houver consumidor real.
- **Dark mode adiado** — v1 comete-se com um único look claro de alta qualidade (ver design-system).
- **Drag & drop da agenda adiado** — v1 entrega remarcar via drawer; DnD entra no refinamento da fase 2.
