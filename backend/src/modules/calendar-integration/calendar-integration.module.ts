import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalendarIntegrationController } from './calendar-integration.controller';
import { CalendarOauthService } from './calendar-oauth.service';
import { CalendarSyncService } from './calendar-sync.service';
import { GoogleCalendarClient } from './google-calendar.client';
import { GoogleTokenCryptoService } from './google-token-crypto.service';

// design.md "File Changes": imports ConfigModule + NotificationsModule
// (usado desde PR 2 por CalendarSyncService, para el aviso in-app de
// invalid_grant), exports CalendarSyncService (stub en PR 1, implementado en
// PR 2 -- ConsultationsModule/PatientsModule la consumen sin cambios de
// forma). El módulo registra su propio JwtModule -- mismo JWT_SECRET que
// AuthModule, pero sin depender de AuthModule (que trae Throttler/Mail/etc.
// que este módulo no necesita) -- para firmar/verificar el `state` del
// handshake OAuth (CalendarOauthService).
@Module({
  imports: [
    ConfigModule,
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') as string,
      }),
    }),
  ],
  controllers: [CalendarIntegrationController],
  providers: [
    GoogleTokenCryptoService,
    CalendarOauthService,
    GoogleCalendarClient,
    CalendarSyncService,
  ],
  exports: [CalendarSyncService],
})
export class CalendarIntegrationModule {}
