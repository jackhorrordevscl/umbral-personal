import './instrument';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as path from 'path';
import { runMigrations } from './common/utils/run-migrations';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody: true (issue #163): además del body ya parseado por Express,
  // Nest guarda los bytes originales en req.rawBody -- WebhooksController
  // (POST /webhooks/resend) lo necesita para verificar la firma Svix, que
  // firma el body exacto que Resend envió, no una re-serialización. No
  // afecta al resto de los endpoints: siguen recibiendo req.body parseado
  // como siempre.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());

  // Orden importa: Nest usa el primer filtro registrado cuyo tipo matchea la
  // excepción. PrismaExceptionFilter (específico) va primero; AllExceptionsFilter
  // (@Catch() sin argumentos, catch-all) va último como red de contención.
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new PrismaExceptionFilter(httpAdapterHost),
    new AllExceptionsFilter(httpAdapterHost),
  );

  app.enableCors({
    origin: [
      process.env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null,
      process.env.LAN_DEV_URL,
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    // sdd/patient-self-scheduling PR 2 (tasks.md 2.4): PUT /availability/schedule
    // es el primer endpoint PUT del backend -- sin agregarlo aquí, un
    // navegador (preflight CORS) lo bloquearía en cualquier origen que no
    // sea same-origin, aunque el backend lo acepte.
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');

  // Cierre ordenado ante SIGTERM/SIGINT (Render envía SIGTERM en cada deploy):
  // dispara OnModuleDestroy/OnApplicationShutdown, p. ej. desconectar Prisma.
  app.enableShutdownHooks();

  // RUN_MIGRATIONS es el mecanismo opt-in para entornos cuyo Start Command no
  // corre las migraciones por su cuenta (ver comentario más abajo sobre por
  // qué esto puede duplicarse con el Start Command de Render, y por qué eso es
  // seguro). Corren ANTES de app.listen y se espera su resultado: si fallan no
  // se sirve tráfico, para no atender requests con un esquema desactualizado.
  if (process.env.RUN_MIGRATIONS === 'true') {
    console.log('🔄 Ejecutando migraciones Prisma...');
    const backendRoot = __dirname.includes('/dist/')
      ? path.join(__dirname, '..', '..')
      : path.join(__dirname, '..');

    // `prisma` (el CLI, no solo @prisma/client) debe permanecer en
    // "dependencies" de package.json, no en devDependencies: el Start Command
    // de Render (ver render.yaml: `npx prisma migrate deploy && npm run
    // start:prod`) también invoca `prisma migrate deploy`, y este exec la
    // corre de nuevo acá. Si algún futuro cleanup de dependencias lo mueve a
    // devDependencies asumiendo que es "solo una CLI de build", esto rompe en
    // producción si el entorno de deploy alguna vez podara devDependencies
    // antes del arranque.
    try {
      const { stdout } = await runMigrations(backendRoot);
      console.log('✅ Migraciones completadas:', stdout);
    } catch (error) {
      console.error(
        '❌ Error en migraciones, el servidor no arrancará:',
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  }

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Servidor corriendo en puerto: ${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('❌ Error fatal al arrancar la aplicación:', error);
  process.exit(1);
});
