import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    PrismaModule,
    AuditModule,
    AuthModule,
    ProfileModule,
    PatientsModule,
    ConsultationsModule,
    ReportsModule,
    DocumentsModule,
    NotificationsModule,
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
