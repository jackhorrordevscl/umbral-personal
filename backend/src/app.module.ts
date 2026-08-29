import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ProfileModule } from './modules/profile/profile.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { CalendarIntegrationModule } from './modules/calendar-integration/calendar-integration.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SharedFilesModule } from './shared-files/shared-files.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
    PrismaModule,
    AuditModule,
    AuthModule,
    ProfileModule,
    PatientsModule,
    ConsultationsModule,
    ReportsModule,
    DocumentsModule,
    NotificationsModule,
    RemindersModule,
    CalendarIntegrationModule,
    PaymentsModule,
    SharedFilesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
