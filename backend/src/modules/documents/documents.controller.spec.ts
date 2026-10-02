import { BadRequestException } from '@nestjs/common';

type FileFilter = (
  req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, accept: boolean) => void,
) => void;

// FileInterceptor captura sus opciones al decorar el controller; se reemplaza
// para poder ejercer el fileFilter sin levantar multer.
jest.mock('@nestjs/platform-express', () => {
  const captured: { fileFilter?: FileFilter }[] = [];
  return {
    __captured: captured,
    FileInterceptor: (_f: string, options: { fileFilter?: FileFilter }) => {
      captured.push(options);
      return class {};
    },
  };
});

import { DocumentsController } from './documents.controller';
import type { DocumentsService } from './documents.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

const capturedOptions = jest.requireMock<{
  __captured: { fileFilter?: FileFilter }[];
}>('@nestjs/platform-express').__captured;

// Issue #289: el fileFilter respondía 500 (Error genérico) y un upload sin
// campo `file` llegaba al servicio y explotaba con un TypeError.
describe('DocumentsController.upload', () => {
  const user = { id: 'user-1' } as RequestUser;
  const dto = { patientId: 'p-1', type: 'REPORT' } as never;
  let service: { uploadDocument: jest.Mock };
  let controller: DocumentsController;

  beforeEach(() => {
    service = { uploadDocument: jest.fn().mockResolvedValue({ id: 'd-1' }) };
    controller = new DocumentsController(
      service as unknown as DocumentsService,
    );
  });

  function runFilter(mimetype: string) {
    const cb = jest.fn();
    capturedOptions[0].fileFilter!({}, { mimetype }, cb);
    return cb;
  }

  it('el fileFilter acepta un PDF', () => {
    expect(runFilter('application/pdf')).toHaveBeenCalledWith(null, true);
  });

  it('el fileFilter rechaza un tipo no permitido con BadRequestException (400, no 500)', () => {
    const cb = runFilter('application/x-msdownload');

    const [error, accept] = cb.mock.calls[0] as [unknown, boolean];
    expect(error).toBeInstanceOf(BadRequestException);
    expect(accept).toBe(false);
  });

  it('responde 400 si falta el archivo, sin llamar al servicio', async () => {
    await expect(
      controller.upload(undefined, dto, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.uploadDocument).not.toHaveBeenCalled();
  });

  it('delega en el servicio cuando el archivo viene', async () => {
    const file = {
      buffer: Buffer.from('x'),
    } as unknown as Express.Multer.File;

    await controller.upload(file, dto, user);

    expect(service.uploadDocument).toHaveBeenCalled();
  });
});
