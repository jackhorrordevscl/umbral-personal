/**
 * Issue #158 (fix CI post-migración a B2): factory de mock para
 * `patient-document-storage.util.ts`, pensada para usarse dentro de un
 * `jest.mock(..., () => ...)` en cada suite e2e que ejercite upload/download
 * de documentos.
 *
 * Antes de la migración a B2 (2e6a722), `documents.service.ts` escribía/leía
 * disco local, que en el runner de CI es efímero pero funcional sin red. Tras
 * la migración, el servicio hace requests reales a Backblaze B2 vía
 * `@aws-sdk/client-s3`, y el workflow de CI (`.github/workflows/ci.yml`) no
 * tiene ningún secret de B2 configurado -- a propósito, el resto del repo
 * mantiene el e2e hermético sin llamadas de red reales (ver
 * `REMINDERS_ENABLED=false`, `GOOGLE_CALENDAR_SYNC_ENABLED=false`).
 *
 * Este helper reemplaza el S3Client real por un Map en memoria, mismo patrón
 * que `documents.service.spec.ts` (unit test) pero aplicado a nivel e2e: cada
 * archivo de test que llama a `createPatientDocumentStorageMock()` obtiene su
 * propio store aislado (un módulo de test = un proceso Jest = un Map nuevo).
 */
export function createPatientDocumentStorageMock() {
  const store = new Map<string, Buffer>();

  function isPatientDocumentNotFoundError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const candidate = err as {
      name?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      candidate.name === 'NoSuchKey' ||
      candidate.Code === 'NoSuchKey' ||
      candidate.$metadata?.httpStatusCode === 404
    );
  }

  return {
    store,
    writePatientDocumentBuffer: jest.fn(
      (objectKey: string, buffer: Buffer): Promise<void> => {
        store.set(objectKey, buffer);
        return Promise.resolve();
      },
    ),
    readPatientDocumentBuffer: jest.fn((objectKey: string): Promise<Buffer> => {
      const buffer = store.get(objectKey);
      if (!buffer) {
        return Promise.reject(
          Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }),
        );
      }
      return Promise.resolve(buffer);
    }),
    deletePatientDocumentObject: jest.fn((objectKey: string): Promise<void> => {
      store.delete(objectKey);
      return Promise.resolve();
    }),
    isPatientDocumentNotFoundError: jest.fn(isPatientDocumentNotFoundError),
  };
}
