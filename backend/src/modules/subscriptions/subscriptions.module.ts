import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  providers: [
    SubscriptionsService,
    // Issue #611: solo lectura al vencer; inactivo mientras
    // SUBSCRIPTIONS_ENFORCED no sea 'true'.
    { provide: APP_INTERCEPTOR, useClass: SubscriptionAccessInterceptor },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
