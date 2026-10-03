// Issue #297: envoltorio de window.location.reload para poder simularlo en
// tests (jsdom no permite reemplazar window.location).
export function reloadPage(): void {
  window.location.reload();
}
