import type { S3Client } from '@aws-sdk/client-s3';

type SentCommand = { constructor: { name: string }; input: unknown };

const mockSend = jest.fn<Promise<unknown>, [SentCommand]>();

jest.mock('@aws-sdk/client-s3', () => {
  const actual: typeof import('@aws-sdk/client-s3') =
    jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

// avatar-storage.util.ts guarda el cliente S3 en un singleton a nivel de
// módulo (`cachedClient`); `jest.isolateModules` fuerza un registro de
// módulos nuevo por test para poder probar tanto la construcción del
// cliente como su reutilización, sin que un test filtre estado al
// siguiente. Se usa `require` (no `import()` dinámico): ts-jest transpila
// este archivo a CommonJS y el runtime de Jest no tiene habilitado
// --experimental-vm-modules para ESM dinámico.
function loadIsolated() {
  let mod!: typeof import('./avatar-storage.util');
  let MockedS3Client!: jest.MockedClass<typeof S3Client>;
  jest.isolateModules(() => {
    const s3: typeof import('@aws-sdk/client-s3') =
      jest.requireMock('@aws-sdk/client-s3');
    MockedS3Client = s3.S3Client as jest.MockedClass<typeof S3Client>;
    mod = jest.requireActual('./avatar-storage.util');
  });
  return { ...mod, MockedS3Client };
}

// Issue #170: avatar-storage.util.ts pasó de leer/escribir disco local a
// hablar con Backblaze B2 vía el SDK de S3. Estos tests mockean el cliente
// S3 (nunca `fs`) y verifican que se llame al comando correcto con el
// Bucket/Key esperados, y que isAvatarNotFoundError distinga un 404 real de
// cualquier otro error (permisos, credenciales, etc.).
describe('avatar-storage.util', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      B2_AVATARS_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
      B2_AVATARS_REGION: 'us-west-004',
      B2_AVATARS_BUCKET: 'umbral-avatars',
      B2_AVATARS_KEY_ID: 'fake-key-id',
      B2_AVATARS_APPLICATION_KEY: 'fake-application-key',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('avatarPath', () => {
    it('devuelve el userId como key, sin extensión', () => {
      const { avatarPath } = loadIsolated();
      expect(avatarPath('user-1')).toBe('user-1');
    });
  });

  describe('readAvatarBuffer', () => {
    it('arma un GetObjectCommand con Bucket/Key correctos y devuelve el buffer', async () => {
      const bytes = new Uint8Array(Buffer.from('avatar-bytes'));
      mockSend.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      });

      const { readAvatarBuffer } = loadIsolated();
      const result = await readAvatarBuffer('user-1');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.constructor.name).toBe('GetObjectCommand');
      expect(command.input).toEqual({
        Bucket: 'umbral-avatars',
        Key: 'user-1',
      });
      expect(result).toEqual(Buffer.from('avatar-bytes'));
    });

    it('lanza si la respuesta de B2 no trae Body', async () => {
      mockSend.mockResolvedValue({ Body: undefined });

      const { readAvatarBuffer } = loadIsolated();
      await expect(readAvatarBuffer('user-1')).rejects.toThrow(
        'Respuesta de B2 sin contenido',
      );
    });

    it('propaga el error de NoSuchKey tal cual (lo traduce el caller vía isAvatarNotFoundError)', async () => {
      const notFound = Object.assign(
        new Error('The specified key does not exist.'),
        { name: 'NoSuchKey' },
      );
      mockSend.mockRejectedValue(notFound);

      const { readAvatarBuffer } = loadIsolated();
      await expect(readAvatarBuffer('user-1')).rejects.toThrow(notFound);
    });
  });

  describe('writeAvatarBuffer', () => {
    it('arma un PutObjectCommand con Bucket/Key/Body correctos', async () => {
      mockSend.mockResolvedValue({});
      const buffer = Buffer.from('fake-image-bytes');

      const { writeAvatarBuffer } = loadIsolated();
      await writeAvatarBuffer('user-1', buffer);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.constructor.name).toBe('PutObjectCommand');
      expect(command.input).toEqual({
        Bucket: 'umbral-avatars',
        Key: 'user-1',
        Body: buffer,
      });
    });
  });

  describe('deleteAvatarObject', () => {
    it('arma un DeleteObjectCommand con Bucket/Key correctos', async () => {
      mockSend.mockResolvedValue({});

      const { deleteAvatarObject } = loadIsolated();
      await deleteAvatarObject('user-1');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.constructor.name).toBe('DeleteObjectCommand');
      expect(command.input).toEqual({
        Bucket: 'umbral-avatars',
        Key: 'user-1',
      });
    });
  });

  describe('cliente S3', () => {
    it('se configura con forcePathStyle y las credenciales de las env vars B2_AVATARS_*', async () => {
      mockSend.mockResolvedValue({});

      const { deleteAvatarObject, MockedS3Client } = loadIsolated();
      await deleteAvatarObject('user-1');

      expect(MockedS3Client).toHaveBeenCalledWith({
        endpoint: 'https://s3.us-west-004.backblazeb2.com',
        region: 'us-west-004',
        credentials: {
          accessKeyId: 'fake-key-id',
          secretAccessKey: 'fake-application-key',
        },
        forcePathStyle: true,
      });
    });

    it('reutiliza la misma instancia de cliente entre llamadas (no reconecta por operación)', async () => {
      mockSend.mockResolvedValue({});

      const { writeAvatarBuffer, deleteAvatarObject, MockedS3Client } =
        loadIsolated();
      await writeAvatarBuffer('user-1', Buffer.from('x'));
      await deleteAvatarObject('user-1');

      expect(MockedS3Client).toHaveBeenCalledTimes(1);
    });
  });

  describe('isAvatarNotFoundError', () => {
    it('true cuando name === NoSuchKey', () => {
      const { isAvatarNotFoundError } = loadIsolated();
      expect(
        isAvatarNotFoundError(
          Object.assign(new Error('x'), { name: 'NoSuchKey' }),
        ),
      ).toBe(true);
    });

    it('true cuando Code === NoSuchKey', () => {
      const { isAvatarNotFoundError } = loadIsolated();
      expect(isAvatarNotFoundError({ Code: 'NoSuchKey' })).toBe(true);
    });

    it('true cuando $metadata.httpStatusCode === 404', () => {
      const { isAvatarNotFoundError } = loadIsolated();
      expect(
        isAvatarNotFoundError({ $metadata: { httpStatusCode: 404 } }),
      ).toBe(true);
    });

    it('false para cualquier otro error (permisos, credenciales, etc.)', () => {
      const { isAvatarNotFoundError } = loadIsolated();
      expect(
        isAvatarNotFoundError(
          Object.assign(new Error('access denied'), {
            name: 'AccessDenied',
            $metadata: { httpStatusCode: 403 },
          }),
        ),
      ).toBe(false);
    });

    it('false para valores no-objeto (null, undefined, string)', () => {
      const { isAvatarNotFoundError } = loadIsolated();
      expect(isAvatarNotFoundError(null)).toBe(false);
      expect(isAvatarNotFoundError(undefined)).toBe(false);
      expect(isAvatarNotFoundError('boom')).toBe(false);
    });
  });
});
