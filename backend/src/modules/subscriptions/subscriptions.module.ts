import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { SubscriptionPriceNoticesService } from './subscription-price-notices.service';
import { SubscriptionRemindersService } from './subscription-reminders.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [MailModule, NotificationsModule],
  providers: [
    SubscriptionsService,
    SubscriptionRemindersService,
    SubscriptionPriceNoticesService,
    // Issue #611: solo lectura al vencer; inactivo mientras
    // SUBSCRIPTIONS_ENFORCED no sea 'true'.
    { provide: APP_INTERCEPTOR, useClass: SubscriptionAccessInterceptor },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
