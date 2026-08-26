import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalendarIntegrationController } from './calendar-integration.controller';
import { CalendarOauthService } from './calendar-oauth.service';
import { CalendarSyncService } from './calendar-sync.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';

// design.md "File Changes": imports ConfigModule + NotificationsModule
// (usado recién en PR 2, para el aviso in-app de invalid_grant), exports
// CalendarSyncService (stub en este PR, implementado en PR 2). El módulo
// registra su propio JwtModule -- mismo JWT_SECRET que AuthModule, pero sin
// depender de AuthModule (que trae Throttler/Mail/etc. que este módulo no
// necesita) -- para firmar/verificar el `state` del handshake OAuth
// (CalendarOauthService).
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
    CalendarSyncService,
  ],
  exports: [CalendarSyncService],
})
export class CalendarIntegrationModule {}
