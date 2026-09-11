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

export interface BookingConfirmation {
  id: string;
  sessionDate: string;
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
