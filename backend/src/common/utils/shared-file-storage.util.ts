import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Issue #170: Render (plan free) no tiene disco persistente -- los
// shared-files escritos a `uploads/shared/` en disco local se pierden en
// cada deploy, aunque el registro `SharedFile` sobreviva en DB. El issue
// #170 original cubría avatares y shared-files; se cerró con solo avatares
// migrados (decisión deliberada del usuario de acotar alcance en ese
// momento). Esto ataca la parte pendiente, mismo patrón que
// `avatar-storage.util.ts` pero indexado por `objectKey` (un archivo por
// objeto, no "un objeto fijo por usuario" -- cada upload genera su propio
// UUID, igual que ya hacía multer con `diskStorage`).
//
// Credenciales/endpoint vía env vars, nunca en el repo -- bucket separado
// del de avatares y del de backups offsite (ver README.md):
//   B2_SHARED_FILES_ENDPOINT, B2_SHARED_FILES_REGION,
//   B2_SHARED_FILES_BUCKET, B2_SHARED_FILES_KEY_ID,
//   B2_SHARED_FILES_APPLICATION_KEY

let cachedClient: S3Client | undefined;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: process.env.B2_SHARED_FILES_ENDPOINT,
      region: process.env.B2_SHARED_FILES_REGION,
      credentials: {
        accessKeyId: process.env.B2_SHARED_FILES_KEY_ID ?? '',
        secretAccessKey: process.env.B2_SHARED_FILES_APPLICATION_KEY ?? '',
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
  return process.env.B2_SHARED_FILES_BUCKET ?? '';
}

export async function readSharedFileBuffer(objectKey: string): Promise<Buffer> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: objectKey }),
  );

  const body = response.Body;
  if (!body) {
    throw new Error('Respuesta de B2 sin contenido (Body vacío)');
  }

  return Buffer.from(await body.transformToByteArray());
}

export async function writeSharedFileBuffer(
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

export async function deleteSharedFileObject(objectKey: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey }),
  );
}

// El SDK de S3 no siempre expone el mismo shape de error para "objeto no
// encontrado": AWS tira una excepción con `name === 'NoSuchKey'`, pero
// algunos proveedores S3-compatibles (B2 incluido, según el endpoint)
// devuelven un 404 genérico sin ese nombre seteado. Se chequean ambas
// formas para no dejar pasar un 404 real como si fuera un error de
// infraestructura (500) -- mismo fix que PR #169 aplicó a avatares.
export function isSharedFileNotFoundError(err: unknown): boolean {
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
