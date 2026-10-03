// Issue #297: el enlace se agrega al DOM (Firefox lo exige) y la URL se
// revoca con retraso; revocarla justo tras click() podía cancelar la descarga.
const REVOKE_DELAY_MS = 10_000

export function downloadBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => window.URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
