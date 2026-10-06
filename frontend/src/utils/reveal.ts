// Desplaza el elemento a la vista sin mover el foco (design.md Decisions 6-8).
// Los guards viven acá y no en un stub global del setup de tests: jsdom no
// implementa scrollIntoView ni matchMedia, y un navegador sin esas APIs debe
// comportarse igual (no hacer nada en vez de lanzar).
export function revealElement(el: HTMLElement | null): void {
  if (!el || typeof el.scrollIntoView !== 'function') return;
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'nearest',
  });
}
