import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { registerGlobalFilters } from './register-global-filters';

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
    meta,
  });
}

@Controller('probe')
class ProbeController {
  @Get('duplicate')
  duplicate() {
    throw prismaError('P2002', { target: ['rut'] });
  }

  @Get('missing')
  missing() {
    throw prismaError('P2025');
  }

  @Get('reference')
  reference() {
    throw prismaError('P2003');
  }

  @Get('unmapped')
  unmapped() {
    throw prismaError('P9999');
  }

  @Get('http')
  http() {
    throw new BadRequestException('RUT inválido');
  }

  @Get('crash')
  crash() {
    throw new Error('fallo interno');
  }
}

describe('registerGlobalFilters', () => {
  let app: INestApplication;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    registerGlobalFilters(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('responde 409 ante un P2002 no manejado', async () => {
    const res = await request(app.getHttpServer() as Server).get(
      '/probe/duplicate',
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: 'Ya existe un registro con ese rut',
    });
  });

  it('responde 404 ante un P2025 no manejado', async () => {
    const res = await request(app.getHttpServer() as Server).get(
      '/probe/missing',
    );

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'Registro no encontrado' });
  });

  it('responde 409 ante un P2003 no manejado', async () => {
    const res = await request(app.getHttpServer() as Server).get(
      '/probe/reference',
    );

    expect(res.status).toBe(409);
  });

  it('responde 500 con mensaje genérico ante un código Prisma no mapeado', async () => {
    const res = await request(app.getHttpServer() as Server).get(
      '/probe/unmapped',
    );

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      message: 'Error al procesar la operación en la base de datos',
    });
  });

  it('conserva el status y el body de una HttpException', async () => {
    const res = await request(app.getHttpServer() as Server).get('/probe/http');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: 'RUT inválido' });
  });

  it('el catch-all sigue respondiendo 500 genérico a un error no manejado', async () => {
    const res = await request(app.getHttpServer() as Server).get(
      '/probe/crash',
    );

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ message: 'Internal server error' });
  });
});
