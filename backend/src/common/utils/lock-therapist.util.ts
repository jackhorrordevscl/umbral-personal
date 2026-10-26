import { Prisma } from '@prisma/client';

// Issue #502: un insert con FK a User y a Patient (historial, consentimiento,
// asentimiento) toma KEY SHARE sobre ambas filas. Si lo hace sin haber tomado
// antes la fila del User, puede cruzarse con una transacción que ya tiene User
// FOR UPDATE y pide Patient FOR UPDATE (consultations.create, reserva pública)
// y quedar en deadlock (40P01). Llamar a esta función primero fija el orden
// User -> Patient del resto de los módulos.
//
// FOR NO KEY UPDATE (el mismo nivel de saveSchedule): conflicta con el FOR
// UPDATE de ConsultationsService.lockTherapistSchedule, así que se serializa
// con esas transacciones, pero no bloquea los inserts de otras tablas con FK
// al terapeuta (FOR KEY SHARE).
export async function lockTherapistForWrite(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  therapistId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${therapistId} FOR NO KEY UPDATE`;
}
