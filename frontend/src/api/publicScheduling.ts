import api from './client';

// sdd/patient-self-scheduling PR 5 (tasks.md 5.2/5.3): tipos y wrappers axios
// para la agenda pública -- contrato tomado directo de
// backend/src/modules/public-scheduling/public-scheduling.controller.ts y
// sus DTOs (public-availability-query.dto.ts, book-public-slot.dto.ts,
// public-booking-patient.dto.ts), no adivinado. Rutas sin autenticación: el
// interceptor de api/client.ts simplemente no agrega Authorization cuando no
// hay token en localStorage (visitante sin sesión), y estos endpoints no
// exigen JWT en el backend (controller sin JwtAuthGuard, PR 3).

export interface PublicSlot {
  start: string; // instante ISO
  end: string;
}

// Formulario reducido -- a diferencia de CreatePatientPayload (patients/
// ficha completa del terapeuta), excluye defaultSessionAmount y cualquier
// campo de documentos/consentimientos legales (design.md "Identity
// resolution gotchas": esos flujos requieren sesión). email es obligatorio
// acá (clave de resolución de identidad para PatientsService.resolveForPublicBooking).
export interface PublicBookingPatientInput {
  fullName: string;
  rut: string;
  birthDate: string;
  email: string;
  occupation?: string;
  address?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  treatingPsychiatrist?: string;
  treatingDoctor?: string;
}

export interface BookPublicSlotPayload {
  slotStart: string;
  patient: PublicBookingPatientInput;
}

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.3, design.md
// "Interfaces / Contracts"): espejo exacto del `CheckoutHint` que
// `PublicSchedulingService.book()` devuelve (public-scheduling.service.ts) --
// PENDING significa "puede aparecer un cargo, empieza a pollear",
// NOT_APPLICABLE corta el polling antes de empezar (cuenta no CONNECTED o
// monto no resoluble).
export type CheckoutHint = { status: 'PENDING' } | { status: 'NOT_APPLICABLE' };

// `paymentUrl: null` mientras ensureCharge() (fire-and-forget en el backend)
// todavía no resuelve -- el polling sigue reintentando hasta que aparezca o
// se agote el presupuesto (ver CHECKOUT_POLL_INTERVAL_MS/CHECKOUT_POLL_TIMEOUT_MS
// en PublicBookingPage.tsx).
export type BookingCheckout =
  | { paymentUrl: string; amount: number }
  | { paymentUrl: null };

export interface BookingConfirmation {
  id: string;
  // === id en la primera versión de una consulta (ver comentario de
  // Consultation.groupId en schema.prisma) -- se usa como :groupId al
  // pollear el endpoint de checkout, nunca se asume igual a `id` sin leerlo
  // de la respuesta real.
  groupId: string;
  sessionDate: string;
  // Ausente cuando PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED está apagado en el
  // backend -- distinto de NOT_APPLICABLE (flag prendido pero sin cargo
  // posible).
  checkout?: CheckoutHint;
}

export function getPublicAvailability(therapistId: string, from: string, to: string) {
  return api
    .get<PublicSlot[]>(`/public/therapists/${therapistId}/availability`, {
      params: { from, to },
    })
    .then((r) => r.data);
}

export function bookPublicSlot(therapistId: string, payload: BookPublicSlotPayload) {
  return api
    .post<BookingConfirmation>(
      `/public/therapists/${therapistId}/availability/book`,
      payload,
    )
    .then((r) => r.data);
}

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.3, backend
// public-scheduling.controller.ts PR 5a): GET sin auth, mismo criterio que
// getPublicAvailability -- el visitante nunca tuvo sesión. `groupId` viene
// siempre de `BookingConfirmation.groupId` (respuesta real del POST de
// reserva), nunca inventado en el cliente.
export function getBookingCheckout(therapistId: string, groupId: string) {
  return api
    .get<BookingCheckout>(
      `/public/therapists/${therapistId}/availability/book/${groupId}/checkout`,
    )
    .then((r) => r.data);
}
