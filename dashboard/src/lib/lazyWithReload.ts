import { lazy, type ComponentType } from 'react';

// Wrapper de React.lazy que recupera automaticamente do erro
// "Failed to fetch dynamically imported module" / "Expected a JavaScript
// module but got text/html".
//
// Esse erro acontece quando um novo deploy troca os hashes dos chunks: uma
// aba aberta antes do deploy ainda tem o index.html antigo e tenta baixar um
// chunk com hash que nao existe mais no servidor (o rewrite SPA devolve o
// index.html, com MIME text/html, e o import falha).
//
// Solucao: ao falhar o import dinamico, recarregamos a pagina UMA vez para
// buscar o index.html novo (com os hashes atuais). Um marcador em
// sessionStorage evita loop de reload caso a falha seja por outro motivo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const FLAG = 'etp_chunk_reloaded_at';
      const last = Number(sessionStorage.getItem(FLAG) || 0);
      const now = Date.now();
      // So recarrega se ainda nao recarregou nos ultimos 10s (anti-loop).
      if (now - last > 10_000) {
        sessionStorage.setItem(FLAG, String(now));
        window.location.reload();
        // Promise que nunca resolve: segura o componente ate o reload ocorrer,
        // evitando um flash do error boundary.
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
