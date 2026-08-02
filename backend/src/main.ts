import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://192.168.1.183:5173',
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
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

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Servidor corriendo en puerto: ${port}`);
  // Las migraciones corren DESPUÉS de que el servidor esté live: RUN_MIGRATIONS
  // es el mecanismo permanente para entornos cuyo Start Command no las corre
  // por su cuenta (ver comentario más abajo sobre por qué esto puede
  // duplicarse con el Start Command de Render, y por qué eso es seguro).
  if (process.env.RUN_MIGRATIONS === 'true') {
    const { exec } = require('child_process');
    const path = require('path');
    console.log('🔄 Ejecutando migraciones Prisma (async)...');
    const backendRoot = __dirname.includes('/dist/')
      ? path.join(__dirname, '..', '..')
      : path.join(__dirname, '..');

    // `prisma` (el CLI, no solo @prisma/client) debe permanecer en
    // "dependencies" de package.json, no en devDependencies: el Start Command
    // configurado en el dashboard de Render (npm run prisma:migrate:deploy
    // && npm run start:prod) también invoca `prisma migrate deploy`, y este
    // exec la corre de nuevo acá. Si algún futuro cleanup de dependencias lo
    // mueve a devDependencies asumiendo que es "solo una CLI de build", esto
    // rompe en producción si el entorno de deploy alguna vez podara
    // devDependencies antes del arranque.
    exec(
      'npx prisma migrate deploy',
      { cwd: backendRoot },
      (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Error en migraciones:', error.message);
          console.error('stderr:', stderr);
        } else {
          console.log('✅ Migraciones completadas:', stdout);
        }
      },
    );
  }
}

bootstrap();
