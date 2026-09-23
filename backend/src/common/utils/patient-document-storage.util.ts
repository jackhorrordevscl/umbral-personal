import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Issue #158: mismo problema de disco efímero de Render que ya se resolvió
// para avatares y shared-files (issue #170) -- `documents` quedó fuera de esa
// migración por alcance en ese momento. Mismo patrón que
// `shared-file-storage.util.ts`, indexado por `objectKey` (un archivo por
// objeto, un UUID por upload) en un bucket B2 separado y propio de
// PatientDocument -- no se reusa el bucket de shared-files/avatares porque
// acá el contenido son documentos clínicos/legales del paciente (Ley 20.584),
// además ya cifrados con AES-256-GCM antes de llegar a este módulo.
//
// Credenciales/endpoint vía env vars, nunca en el repo (ver README.md):
//   B2_PATIENT_DOCUMENTS_ENDPOINT, B2_PATIENT_DOCUMENTS_REGION,
//   B2_PATIENT_DOCUMENTS_BUCKET, B2_PATIENT_DOCUMENTS_KEY_ID,
//   B2_PATIENT_DOCUMENTS_APPLICATION_KEY

let cachedClient: S3Client | undefined;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: process.env.B2_PATIENT_DOCUMENTS_ENDPOINT,
      region: process.env.B2_PATIENT_DOCUMENTS_REGION,
      credentials: {
        accessKeyId: process.env.B2_PATIENT_DOCUMENTS_KEY_ID ?? '',
        secretAccessKey: process.env.B2_PATIENT_DOCUMENTS_APPLICATION_KEY ?? '',
      },
      // B2 (como la mayoría de proveedores S3-compatibles) requiere
      // path-style requests -- el virtual-hosted-style (bucket.endpoint) que
      // el SDK arma por default no resuelve contra Backblaze.
      forcePathStyle: true,
    });
  }
  return cachedClient;
}

function getBucket(): string {
  return process.env.B2_PATIENT_DOCUMENTS_BUCKET ?? '';
}

export async function readPatientDocumentBuffer(
  objectKey: string,
): Promise<Buffer> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: objectKey }),
  );

  const body = response.Body;
  if (!body) {
    throw new Error('Respuesta de B2 sin contenido (Body vacío)');
  }

  return Buffer.from(await body.transformToByteArray());
}

export async function writePatientDocumentBuffer(
  objectKey: string,
  buffer: Buffer,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: objectKey,
      Body: buffer,
    }),
  );
}

export async function deletePatientDocumentObject(
  objectKey: string,
): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey }),
  );
}

// El SDK de S3 no siempre expone el mismo shape de error para "objeto no
// encontrado": AWS tira una excepción con `name === 'NoSuchKey'`, pero
// algunos proveedores S3-compatibles (B2 incluido, según el endpoint)
// devuelven un 404 genérico sin ese nombre seteado. Se chequean ambas
// formas para no dejar pasar un 404 real como si fuera un error de
// infraestructura (500) -- mismo criterio que `shared-file-storage.util.ts`.
export function isPatientDocumentNotFoundError(err: unknown): boolean {
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
