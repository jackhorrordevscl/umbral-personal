// Issue #300: escapa los caracteres con significado especial en HTML para
// interpolar texto controlado por el usuario (nombres, emails) en templates
// de email sin que el receptor lo interprete como marcado. Sirve tanto para
// contenido de elementos como para valores de atributos entre comillas.
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
