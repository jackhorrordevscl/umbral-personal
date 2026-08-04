import { NotFoundException } from '@nestjs/common';
import { SharedFile } from '@prisma/client';
import { SharedFilesService } from './shared-files.service';
import { PrismaService } from '../prisma/prisma.service';

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
});
