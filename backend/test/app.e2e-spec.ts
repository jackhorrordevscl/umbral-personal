import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  // Hallazgo del judgment-day transversal (#502): ninguna ruta enviaba
  // Cache-Control, así que PDFs, descargas y JSON clínico podían quedar en el
  // caché del navegador (helmet() no lo fija).
  it('toda respuesta lleva Cache-Control: no-store, también las de error', async () => {
    const ok = await request(app.getHttpServer()).get('/').expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');

    const unauthorized = await request(app.getHttpServer())
      .get('/patients')
      .expect(401);
    expect(unauthorized.headers['cache-control']).toBe('no-store');
  });
});
