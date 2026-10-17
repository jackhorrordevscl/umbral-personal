import { ConflictException } from '@nestjs/common';

export const PUBLIC_BOOKING_REJECTED_MESSAGE =
  'No fue posible procesar la reserva.';

/**
 * A public booking was refused because the submitted identity collides with a
 * stored patient (email/RUT match, closed treatment, ambiguous email, race).
 * PublicSchedulingService turns it into the same success response a new
 * patient gets, so an anonymous caller cannot tell whether a person is
 * registered with the therapist (issue #502). `notifyEmail` is the stored
 * address of the patient the attempt collided with, when there is one.
 */
export class PublicBookingRejectedException extends ConflictException {
  constructor(readonly notifyEmail: string | null = null) {
    super(PUBLIC_BOOKING_REJECTED_MESSAGE);
  }
}
