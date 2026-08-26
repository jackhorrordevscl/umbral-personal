import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RemindersService } from './reminders.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [ConfigModule, NotificationsModule, MailModule],
  providers: [RemindersService],
})
export class RemindersModule {}
