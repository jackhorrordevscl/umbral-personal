import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Issue #170: Render (plan free) no tiene disco persistente -- los avatares
// escritos a `uploads/avatars/` en disco local se perdían en cada deploy,
// aunque `User.avatarMimeType` sobreviviera en DB (ver PR #169, que solo
// evitó el 500 resultante, no la pérdida de datos). Se migra el storage a
// Backblaze B2 (S3-compatible, alcance: solo avatares -- shared-files queda
// fuera, decisión explícita del usuario) manteniendo la misma interfaz
// pública que ya consumían ProfileService y PublicTherapistProfileService
// (issue #155) para minimizar el diff en ambos call sites.
//
// Credenciales/endpoint vía env vars, nunca en el repo -- se cargan en el
// dashboard de Render (ver README.md):
//   B2_AVATARS_ENDPOINT, B2_AVATARS_REGION, B2_AVATARS_BUCKET,
//   B2_AVATARS_KEY_ID, B2_AVATARS_APPLICATION_KEY

let cachedClient: S3Client | undefined;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: process.env.B2_AVATARS_ENDPOINT,
      region: process.env.B2_AVATARS_REGION,
      credentials: {
        accessKeyId: process.env.B2_AVATARS_KEY_ID ?? '',
        secretAccessKey: process.env.B2_AVATARS_APPLICATION_KEY ?? '',
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
  return process.env.B2_AVATARS_BUCKET ?? '';
}

// Ruta fija por usuario (SIN extensión), mismo criterio que la versión en
// disco: un solo objeto por usuario, el upload nuevo pisa el anterior.
export function avatarPath(userId: string): string {
  return userId;
}

export async function readAvatarBuffer(userId: string): Promise<Buffer> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: avatarPath(userId) }),
  );

  const body = response.Body;
  if (!body) {
    throw new Error('Respuesta de B2 sin contenido (Body vacío)');
  }

  return Buffer.from(await body.transformToByteArray());
}

export async function writeAvatarBuffer(
  userId: string,
  buffer: Buffer,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: avatarPath(userId),
      Body: buffer,
    }),
  );
}

export async function deleteAvatarObject(userId: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: avatarPath(userId) }),
  );
}

// El SDK de S3 no siempre expone el mismo shape de error para "objeto no
// encontrado": AWS tira una excepción con `name === 'NoSuchKey'`, pero
// algunos proveedores S3-compatibles (B2 incluido, según el endpoint)
// devuelven un 404 genérico sin ese nombre seteado. Se chequean ambas
// formas para no dejar pasar un 404 real como si fuera un error de
// infraestructura (500) -- reemplaza el chequeo de `ENOENT` que usaba la
// versión en disco.
export function isAvatarNotFoundError(err: unknown): boolean {
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
