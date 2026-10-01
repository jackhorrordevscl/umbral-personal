import type { Logger } from '@nestjs/common';
import type { AuditService } from '../../modules/audit/audit.service';

type AuditEntry = Parameters<AuditService['log']>[0];

// Registra un evento de auditoría sin poder romper ni alterar la respuesta del
// request: la promesa devuelta nunca rechaza (un fallo se reporta con
// Logger.error). Los llamadores que no deben variar su tiempo de respuesta
// (p. ej. un login fallido) pueden no esperarla.
export async function logAuditFailOpen(
  auditService: AuditService,
  logger: Logger,
  entry: AuditEntry,
): Promise<void> {
  try {
    await auditService.log(entry);
  } catch (err) {
    logger.error(
      `Fallo al registrar auditoría: userId=${entry.userId ?? 'N/A'} action=${entry.action} resource=${entry.resource} — ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : undefined,
    );
  }
}
