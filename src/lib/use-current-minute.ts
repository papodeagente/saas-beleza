"use client";

import { useSyncExternalStore } from "react";

/**
 * Relógio compartilhado da interface.
 *
 * O "agora" é do cliente, então nunca pode ser lido durante o render do
 * servidor (a linha do agora ficaria em posições diferentes nos dois lados).
 * Um único intervalo alimenta todos os assinantes.
 */

let currentMinute = Math.floor(Date.now() / 60_000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      const next = Math.floor(Date.now() / 60_000);
      if (next === currentMinute) return;
      currentMinute = next;
      for (const listener of listeners) listener();
    }, 15_000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Minuto atual em epoch/60000, ou null no servidor e no primeiro render. */
export function useCurrentMinute(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => currentMinute,
    () => null,
  );
}
