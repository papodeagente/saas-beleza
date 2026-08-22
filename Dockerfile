# Build em estágios: as dependências de build não vão para a imagem final.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# pnpm-workspace.yaml carrega o allowBuilds — sem ele o install falha em CI
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# O servidor standalone do Next escuta em `process.env.HOSTNAME`, e no Docker
# essa variável é o ID do contêiner — o processo então NÃO atende em 127.0.0.1
# e todo healthcheck local falha. Era a causa do status vermelho no Coolify.
ENV HOSTNAME=0.0.0.0
# O healthcheck do Coolify roda DENTRO do contêiner e chama curl. A alpine não
# traz curl, então o comando falhava com "not found" e a aplicação aparecia
# como caída mesmo servindo 200. ~1 MB para a plataforma poder dizer a verdade.
RUN apk add --no-cache curl
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: standalone` já traz apenas o necessário para rodar
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Migrations aplicadas no start, antes do servidor aceitar tráfego
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs

USER nextjs
EXPOSE 3000

# Sinal de saúde para o orquestrador. Sem ele o Coolify marcava a aplicação
# como caída mesmo servindo tráfego — era a causa do status vermelho.
#
# Usa o `wget` do busybox, que já vem na alpine: o healthcheck do Coolify exige
# curl ou wget, e instalar curl só para isso engorda a imagem à toa.
#
# Aponta para /api/live, que não toca no banco: liveness não é readiness — uma
# oscilação do Postgres não pode fazer o orquestrador derrubar o contêiner.
#
# A janela é curta de propósito. O Coolify tenta poucas vezes e desiste; um
# start-period longo faz o contêiner ainda estar "starting" quando ele desiste,
# e o deploy é revertido por engano.
HEALTHCHECK --interval=5s --timeout=4s --start-period=10s --retries=8 \
  CMD curl -fsS http://127.0.0.1:3000/api/live >/dev/null || exit 1

# `exec` faz o node virar PID 1: sem isso o shell fica no lugar dele e o
# SIGTERM do `docker stop` nunca chega na aplicação.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
