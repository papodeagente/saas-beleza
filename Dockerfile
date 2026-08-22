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
# Sem isto o servidor do Next escuta apenas no hostname do contêiner (o Docker
# define HOSTNAME com o id da instância) e 127.0.0.1 não responde — foi o que
# derrubou o healthcheck, que testa justamente o loopback.
ENV HOSTNAME=0.0.0.0
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

# Sinal de saúde para o orquestrador. Sem ele o Coolify não distingue "no ar"
# de "morto" e marca a aplicação como caída mesmo servindo tráfego.
# Usa o fetch nativo do Node em vez de curl: a imagem alpine não tem curl e
# instalar um pacote só para isso engorda a imagem à toa.
HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `exec` faz o node virar PID 1: sem isso o shell fica no lugar dele e o
# SIGTERM do `docker stop` nunca chega na aplicação.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
