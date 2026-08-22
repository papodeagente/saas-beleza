# Atendimento por WhatsApp e agente de IA

Portado do `entur-os-crm`, onde esse módulo roda há tempo suficiente para ter
uma lista de cicatrizes. A stack é outra (App Router e Drizzle no lugar de
Express e tRPC), então nada foi copiado linha a linha: o que veio junto foram
as regras que existem por causa de incidentes reais, e cada uma delas está
comentada no código onde vale.

## Caminho de uma mensagem

```
cliente escreve
   ↓
uazapi  →  POST /api/webhooks/uazapi/{segredo}
   ↓
normalizador  →  evento canônico (mensagem, status ou conexão)
   ↓
grava evento bruto (idempotência + depuração)
   ↓
resolve conversa e cliente (por JID; telefone canônico liga ao cadastro)
   ↓
grava mensagem, atualiza a conversa, joga para a fila se não tem dono
   ↓
enfileira turno do agente (Redis, com janela de agrupamento)
   ↓
worker: portões → modelo + ferramentas → envia pelo mesmo caminho do humano
```

## Conexão manual, por escolha

A instância da uazapi é do cliente. Este sistema guarda apenas a URL do
servidor e o token da instância, e valida os dois contra `/instance/status`
antes de gravar. Não existe token de administração aqui, então não há como
criar, cobrar ou derrubar instância a partir do sistema.

O webhook é apontado à mão no painel da uazapi, para a URL que a tela mostra.
Como a uazapi não assina o payload, o segredo é a própria URL — daí o botão de
gerar uma nova, que invalida a anterior na hora.

Eventos a marcar na uazapi: `messages`, `messages_update`, `connection`.

## O que não pode ser afrouxado

Cada item abaixo é a correção de uma falha que já aconteceu em produção no
entur-os-crm. Mexer neles sem entender o motivo reabre o buraco.

**Pausa da IA é relida no instante do envio.** O valor lido no início do turno
já está velho quando o modelo termina de responder, e nesse intervalo cabe um
clique em "pausar". Ver `isPausedNow` em `agent-turn-processor.ts`.

**Marca-d'água do último inbound respondido.** Avança de forma síncrona no
envio. Sem ela, o eco do webhook chega depois e um retry responde de novo.

**Idempotência em duas camadas.** Evento bruto e mensagem, ambos por chave
única. A uazapi reentrega.

**Índices únicos completos, nunca parciais, onde há `ON CONFLICT`.** O Postgres
não usa índice parcial como árbitro de conflito e devolve 42P10. NULL já é
tratado como valor distinto, então o índice completo faz o que se quer.

**Identidade pelo JID, telefone canônico só para ligar ao cadastro.** Chat
opaco (`@lid`) tratado como telefone gera conversa duplicada; celular com e sem
o nono dígito gera cliente duplicado.

**Fila do inbox.** Mensagem nova devolve a conversa à fila quando ela não tem
dono, inclusive depois de resolvida. Quem atendeu por último é contexto, não
dono: essa pessoa pode estar de folga.

**Permissão é o gate, não o prompt.** A lista de ferramentas é filtrada antes
de o modelo ver o que existe, e a execução confere de novo.

**Ferramenta usa o serviço de domínio.** Agendar pela IA percorre o mesmo
caminho de agendar pela tela. Uma segunda implementação divergiria em silêncio.

**Simulador chama a função do atendimento real.** Testar por caminho paralelo
dá confiança falsa.

**Texto do agente sai sem travessão.** O prompt pede, o modelo esquece, o
sanitizador garante (`text-style.ts`).

## Modelo

Padrão `claude-opus-5`, pelo SDK oficial. OpenAI está disponível para quem
preferir, com uma ressalva herdada: os modelos de raciocínio da OpenAI recusam
function tools em `/v1/chat/completions`, então só entram no catálogo os
comprovadamente compatíveis, e uma configuração antiga apontando para um deles
é remapeada em tempo de execução.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Fila de turnos, lock por conversa e limites. Sem ela o agente não responde |
| `APP_URL` | Endereço público, usado para montar a URL do webhook |
| `ANTHROPIC_API_KEY` | Necessária para os modelos Claude |
| `OPENAI_API_KEY` | Necessária para os modelos OpenAI |
| `AGENT_WORKER_ENABLED` | `false` desliga o worker neste processo |

## Ainda não portado

Sugestão de resposta para o atendente, resumo de conversa, transcrição de áudio
(o campo existe e o agente já espera por ele), etiquetas, modelos de mensagem,
disparo em massa, reengajamento automático e métricas de atendimento.
