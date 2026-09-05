/**
 * Service worker do Agenda de Unha.
 *
 * REGRA QUE MANDA AQUI: este arquivo NUNCA serve conteúdo de agenda a partir do
 * cache.
 *
 * A tentação de um service worker é cachear tudo para a tela abrir rápido. Num
 * produto de hora marcada isso é um defeito, não um ganho: uma grade de
 * horários guardada de ontem mostra vaga que já foi ocupada, a cliente escolhe,
 * e o servidor recusa no último passo — ou, pior, o EXCLUDE do banco recusa e
 * ela conclui que o site não funciona. O que se ganha em milissegundos se perde
 * em confiança.
 *
 * Então o escopo é estreito e deliberado:
 *   - `/_next/static/*` e os ícones: cache primeiro. São imutáveis, o nome do
 *     arquivo carrega o hash do conteúdo, e trocar de versão troca de URL.
 *   - Navegação (HTML): rede primeiro, e o cache SÓ como rede de segurança
 *     quando não há internet — servindo uma página de "sem conexão", não uma
 *     agenda velha.
 *   - Todo o resto (API, Server Action, POST, qualquer coisa com credencial):
 *     passa direto, sem tocar no cache.
 *
 * A versão está no nome do cache. Mudou o arquivo, muda a versão, e o `activate`
 * apaga as antigas — um cache que não sabe se aposentar é como um service
 * worker quebra um site para sempre.
 */

const VERSAO = "adu-v1";
const CACHE_ESTATICO = `${VERSAO}-estatico`;
const CACHE_CASCA = `${VERSAO}-casca`;
const PAGINA_OFFLINE = "/offline";

const PRE_CACHE = [PAGINA_OFFLINE, "/icon.svg", "/app-icon-192.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_CASCA);
      // `catch` individual: um recurso que falhe não pode abortar a instalação
      // inteira e deixar o usuário sem service worker nenhum.
      await Promise.all(
        PRE_CACHE.map((url) => cache.add(url).catch(() => undefined)),
      );
      // Assume o controle já nesta carga em vez de esperar todas as abas
      // fecharem. Sem isto, uma correção publicada hoje só chega semana que vem.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((nome) => !nome.startsWith(VERSAO)).map((nome) => caches.delete(nome)),
      );
      await self.clients.claim();
    })(),
  );
});

/** O que pode ser guardado sem risco: estático de build e ícone. */
function ehEstatico(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    /\.(?:png|svg|ico|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;

  // Só GET. POST é Server Action ou agendamento — nunca passa por cache.
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);

  // Outro domínio não é assunto nosso.
  if (url.origin !== self.location.origin) return;

  // A API é sempre fresca. É ela que sabe qual horário ainda está livre.
  if (url.pathname.startsWith("/api/")) return;

  if (ehEstatico(url)) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_ESTATICO);
        const guardado = await cache.match(requisicao);
        if (guardado) return guardado;
        const resposta = await fetch(requisicao);
        // Só guarda resposta boa e completa: guardar um 404 ou um 206 deixa o
        // erro grudado até a próxima troca de versão.
        if (resposta.ok && resposta.status === 200) {
          cache.put(requisicao, resposta.clone());
        }
        return resposta;
      })(),
    );
    return;
  }

  if (requisicao.mode === "navigate") {
    evento.respondWith(
      (async () => {
        try {
          return await fetch(requisicao);
        } catch {
          // Sem rede. Devolve a página de aviso — NÃO uma versão guardada da
          // agenda, que estaria desatualizada exatamente no dado que importa.
          const cache = await caches.open(CACHE_CASCA);
          return (
            (await cache.match(PAGINA_OFFLINE)) ??
            new Response("Sem conexão.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
  }
});
