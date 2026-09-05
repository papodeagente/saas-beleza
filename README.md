# Lumina — sistema operacional para negócios de estética

SaaS multi-tenant que integra WhatsApp → IA → cliente → agenda → atendimento →
pagamento → financeiro → retenção num único produto.

- Visão, domínio e arquitetura: [docs/product-architecture.md](docs/product-architecture.md)
- Design system: [docs/design-system.md](docs/design-system.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL 16 · Drizzle · Tailwind v4 · Zod · Vitest

## Rodando local

```bash
pnpm install
cp .env.example .env.local   # e preencha DATABASE_URL
pnpm db:migrate
pnpm db:seed                 # cria a Clínica Lumina de demonstração
pnpm dev
```

O seed sorteia a senha da conta de demonstração e a imprime no console ao terminar —
ela existe só naquele banco e nunca neste repositório, que é público.
Página pública de agendamento: `/agendar/clinica-lumina`

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Servidor de desenvolvimento |
| `pnpm build` | Build de produção (standalone) |
| `pnpm test` | Testes (disponibilidade, tenancy, double booking, financeiro) |
| `pnpm typecheck` | Checagem de tipos |
| `pnpm db:generate` | Gera migration a partir do schema |
| `pnpm db:migrate` | Aplica migrations |
| `pnpm db:seed` | Recria os dados de demonstração |

## Deploy

Imagem Docker multi-stage; as migrations rodam no start do contêiner
(`scripts/migrate.mjs`) antes do servidor aceitar tráfego.
Variável obrigatória: `DATABASE_URL`.
