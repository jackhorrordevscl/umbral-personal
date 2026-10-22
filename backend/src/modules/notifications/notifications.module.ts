import { Module } from '@nestjs/common';
import { ClinicalTextCryptoModule } from '../../common/crypto/clinical-text-crypto.module';
import { NotificationsService } from './notifications.service';
import { NotificationsPurgeService } from './notifications-purge.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [ClinicalTextCryptoModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsPurgeService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
