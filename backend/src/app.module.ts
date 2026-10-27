import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { buildAppThrottlerOptions } from './config/throttler.config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SessionOriginGuard } from './common/guards/session-origin.guard';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { ClinicalTextCryptoModule } from './common/crypto/clinical-text-crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { DischargesModule } from './modules/discharges/discharges.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ProfileModule } from './modules/profile/profile.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { CalendarIntegrationModule } from './modules/calendar-integration/calendar-integration.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { PublicSchedulingModule } from './modules/public-scheduling/public-scheduling.module';
import { SharedFilesModule } from './shared-files/shared-files.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ClientIpMiddleware } from './common/middleware/client-ip.middleware';
import { NoStoreMiddleware } from './common/middleware/no-store.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // sdd/session-reminders PR 2: timers en proceso, no spawnea nada --
    // RemindersService.scan() está guardado detrás de REMINDERS_ENABLED
    // (T4.5), así que registrar ScheduleModule acá no dispara el cron por
    // sí solo en entornos donde ese flag esté en "false" (p. ej. e2e).
    ScheduleModule.forRoot(),
    // Issue #363: único registro del ThrottlerModule (@Global()); ver
    // config/throttler.config.ts.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildAppThrottlerOptions,
    }),
    PrismaModule,
    // ADR 0004 (opción B): valida CLINICAL_TEXT_ENCRYPTION_KEY al arrancar.
    ClinicalTextCryptoModule,
    AuditModule,
    AuthModule,
    ProfileModule,
    PatientsModule,
    ConsultationsModule,
    DischargesModule,
    ReportsModule,
    DocumentsModule,
    NotificationsModule,
    SubscriptionsModule,
    RemindersModule,
    CalendarIntegrationModule,
    PaymentsModule,
    AvailabilityModule,
    // sdd/patient-self-scheduling PR 3: superficie pública sin JwtAuthGuard
    // (GET/POST .../public/therapists/:id/availability[/book]), gateada por
    // PUBLIC_SCHEDULING_ENABLED (design.md "Migration / Rollout").
    PublicSchedulingModule,
    SharedFilesModule,
    // issue #163: POST /webhooks/resend, público (Resend no manda JWT).
    // Necesita req.rawBody (ver `rawBody: true` en main.ts) para verificar
    // la firma Svix contra los bytes exactos del body.
    WebhooksModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // Issue #487: defensa en profundidad contra CSRF sobre la cookie de sesión.
    {
      provide: APP_GUARD,
      useClass: SessionOriginGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  // Issue #301: deja la IP real del cliente en req.clientIp antes de guards e
  // interceptores (auditoría, sesiones, historial de MFA). NoStoreMiddleware
  // marca toda respuesta como no almacenable (#502).
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ClientIpMiddleware, NoStoreMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
