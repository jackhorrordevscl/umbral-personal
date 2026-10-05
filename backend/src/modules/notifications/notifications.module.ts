import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsPurgeService } from './notifications-purge.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsPurgeService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
