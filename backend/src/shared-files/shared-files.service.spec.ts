import { NotFoundException } from '@nestjs/common';
import { SharedFile } from '@prisma/client';
import { SharedFilesService } from './shared-files.service';
import { PrismaService } from '../prisma/prisma.service';
import * as sharedFileStorage from '../common/utils/shared-file-storage.util';

jest.mock('../common/utils/shared-file-storage.util');

const mockReadSharedFileBuffer =
  sharedFileStorage.readSharedFileBuffer as jest.MockedFunction<
    typeof sharedFileStorage.readSharedFileBuffer
  >;

// isSharedFileNotFoundError es lógica pura (no I/O) -- se usa la
// implementación real en vez de mockearla, así estos tests siguen probando
// la traducción real de errores de B2 a 404, no un mock que siempre dice lo
// que el test quiere.
const { isSharedFileNotFoundError } = jest.requireActual<
  typeof sharedFileStorage
>('../common/utils/shared-file-storage.util');
(sharedFileStorage.isSharedFileNotFoundError as jest.Mock).mockImplementation(
  isSharedFileNotFoundError,
);

function buildFile(overrides: Partial<SharedFile> = {}): SharedFile {
  return {
    id: 'file-1',
    name: 'protocolo.pdf',
    originalName: 'protocolo.pdf',
    filename: 'uuid.pdf',
    path: '/tmp/uuid.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    category: 'GENERAL',
    description: null,
    isActive: true,
    uploadedById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as SharedFile;
}

describe('SharedFilesService', () => {
  let service: SharedFilesService;
  let prisma: { sharedFile: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = {
      sharedFile: {
        findFirst: jest.fn(),
      },
    };
    service = new SharedFilesService(prisma as unknown as PrismaService);
  });

  describe('findOne', () => {
    it('lanza 404 si el archivo no existe', async () => {
      prisma.sharedFile.findFirst.mockResolvedValue(null);

      await expect(service.findOne('file-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza 404 (no 403) si el archivo es de otro usuario, para no filtrar vía status code que el id pertenece a alguien más', async () => {
      prisma.sharedFile.findFirst.mockResolvedValue(
        buildFile({ uploadedById: 'other-user' }),
      );

      await expect(service.findOne('file-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('file-1', 'user-1')).rejects.toThrow(
        'Archivo no encontrado',
      );
    });

    it('devuelve el archivo si pertenece al usuario', async () => {
      const file = buildFile();
      prisma.sharedFile.findFirst.mockResolvedValue(file);

      await expect(service.findOne('file-1', 'user-1')).resolves.toEqual(file);
    });
  });

  describe('getFileBuffer', () => {
    beforeEach(() => {
      mockReadSharedFileBuffer.mockReset();
    });

    it('devuelve el buffer si el objeto existe en B2', async () => {
      const file = buildFile();
      prisma.sharedFile.findFirst.mockResolvedValue(file);
      const buffer = Buffer.from('contenido');
      mockReadSharedFileBuffer.mockResolvedValue(buffer);

      await expect(service.getFileBuffer('file-1', 'user-1')).resolves.toEqual(
        buffer,
      );
      expect(mockReadSharedFileBuffer).toHaveBeenCalledWith(file.filename);
    });

    // Mismo caso que PR #169 (avatares): el registro sobrevive en DB pero el
    // objeto detrás en B2 ya no existe (disco efímero de Render en archivos
    // subidos antes de esta migración, borrado manual, etc.) -- debe ser 404,
    // no un 500.
    it('lanza 404 si el registro existe en DB pero el objeto no está en B2', async () => {
      const file = buildFile();
      prisma.sharedFile.findFirst.mockResolvedValue(file);
      mockReadSharedFileBuffer.mockRejectedValue(
        Object.assign(new Error('not found'), { name: 'NoSuchKey' }),
      );

      await expect(service.getFileBuffer('file-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propaga errores de infraestructura que no son "no encontrado"', async () => {
      const file = buildFile();
      prisma.sharedFile.findFirst.mockResolvedValue(file);
      mockReadSharedFileBuffer.mockRejectedValue(
        new Error('credenciales inválidas'),
      );

      await expect(service.getFileBuffer('file-1', 'user-1')).rejects.toThrow(
        'credenciales inválidas',
      );
    });
  });
});
