import { Injectable, Logger } from '@nestjs/common';

// sdd/google-calendar-integration PR 1: stub. La propagación real
// (syncGroup/reconcile, design.md "Fire-and-forget intents plus a bounded
// reconciler") se implementa en PR 2 -- este PR solo fija la superficie de
// exportación del módulo (CalendarIntegrationModule.exports) para que
// ConsultationsModule pueda importarla sin cambios de forma cuando PR 2 la
// complete. Ningún llamador la invoca todavía.
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);
}
