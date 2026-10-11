import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import ErrorBanner from '../ui/ErrorBanner';
import FormField from '../ui/FormField';
import { getApiErrorMessage } from '../../utils/api-error';
import { normalizeRut, validateRut } from '../../utils/rut';
import { isMinorOnChileDay } from '../../utils/age';
import { useBookPublicSlot } from '../../hooks/usePublicScheduling';
import type {
  BookPublicSlotPayload,
  BookingConfirmation,
  GuardianRelationship,
  PublicBookingOrigin,
  PublicBookingPatientInput,
} from '../../api/publicScheduling';

const RELATIONSHIP_OPTIONS: { value: GuardianRelationship; label: string }[] = [
  { value: 'MOTHER', label: 'Madre' },
  { value: 'FATHER', label: 'Padre' },
  { value: 'LEGAL_GUARDIAN', label: 'Tutor/a legal' },
  { value: 'CURATOR', label: 'Curador/a' },
  { value: 'CAREGIVER', label: 'Cuidador/a' },
  { value: 'OTHER', label: 'Otro/a' },
];

function isRelationship(value: string): value is GuardianRelationship {
  return RELATIONSHIP_OPTIONS.some((option) => option.value === value);
}

const emailFormat = z.string().email();
const isEmail = (value: string) => emailFormat.safeParse(value).success;

// sdd/patient-self-scheduling PR 5 (tasks.md 5.3, design.md "Identity
// resolution gotchas"): formulario REDUCIDO -- solo los campos que
// PublicBookingPatientDto exige para identidad (fullName, rut, birthDate,
// email); a diferencia de PatientForm (ficha completa del terapeuta) omite a
// propósito defaultSessionAmount y documentos/consentimientos legales, que
// ese DTO ni siquiera acepta. rut reusa el mismo validador que PatientForm
// (utils/rut.ts), sin duplicar el algoritmo de dígito verificador.
//
// Booking for a minor (isMinor): the patient's email becomes optional and the
// legal guardian block is required. Every rule lives in one superRefine
// because they depend on isMinor and so that all errors show at once. The
// minor-ness hints are only a client-side consistency check: the backend
// decides from birthDate and stays the authority.
const publicBookingFormSchema = z
  .object({
    isMinor: z.boolean(),
    fullName: z.string(),
    rut: z.string(),
    birthDate: z.string(),
    email: z.string(),
    guardian: z.object({
      fullName: z.string(),
      rut: z.string(),
      relationship: z.string(),
      email: z.string(),
      phone: z.string(),
    }),
  })
  .superRefine((values, ctx) => {
    const fail = (path: string[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (!values.fullName) fail(['fullName'], 'El nombre es obligatorio');
    if (!validateRut(values.rut)) fail(['rut'], 'RUT inválido');
    if (!values.birthDate) {
      fail(['birthDate'], 'La fecha de nacimiento es obligatoria');
    } else if (values.isMinor && !isMinorOnChileDay(values.birthDate)) {
      fail(['birthDate'], 'El paciente debe ser menor de 18 años para reservar por un menor.');
    } else if (!values.isMinor && isMinorOnChileDay(values.birthDate)) {
      fail(
        ['birthDate'],
        'Si el paciente es menor de 18 años, marca la opción «Reservo para un menor de edad».',
      );
    }

    const email = values.email.trim();
    if (!email && !values.isMinor) fail(['email'], 'El email es obligatorio');
    else if (email && !isEmail(email)) fail(['email'], 'Email inválido');

    if (!values.isMinor) return;
    const guardian = values.guardian;
    if (!guardian.fullName.trim()) {
      fail(['guardian', 'fullName'], 'El nombre del representante es obligatorio');
    }
    if (!validateRut(guardian.rut)) {
      fail(['guardian', 'rut'], 'RUT inválido');
    } else if (
      validateRut(values.rut) &&
      normalizeRut(guardian.rut) === normalizeRut(values.rut)
    ) {
      fail(['guardian', 'rut'], 'El RUT del representante debe ser distinto al del paciente.');
    }
    if (!isRelationship(guardian.relationship)) {
      fail(['guardian', 'relationship'], 'Selecciona la relación con el paciente');
    }
    const guardianEmail = guardian.email.trim();
    if (!guardianEmail) {
      fail(['guardian', 'email'], 'El correo del representante es obligatorio');
    } else if (!isEmail(guardianEmail)) {
      fail(['guardian', 'email'], 'Email inválido');
    }
  });

// La politica de privacidad vive fuera de este repo (sitio institucional), por
// eso es un enlace absoluto y no una ruta interna.
const PRIVACY_POLICY_URL = 'https://umbral.groundzerodevs.com/privacidad-general';

const LINK_FOCUS_RING =
  'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

type PublicBookingFormValues = z.infer<typeof publicBookingFormSchema>;

// Adult payload stays exactly as before (no guardian key, email included);
// for a minor, the patient's email and the guardian's phone are sent only
// when filled in.
function buildPayload(
  values: PublicBookingFormValues,
  slotStart: string,
  origin: PublicBookingOrigin | undefined,
): BookPublicSlotPayload {
  const patient: PublicBookingPatientInput = {
    fullName: values.fullName,
    rut: normalizeRut(values.rut),
    birthDate: values.birthDate,
  };
  if (!values.isMinor || values.email.trim()) patient.email = values.email;
  const payload: BookPublicSlotPayload = { slotStart, patient, origin };
  const { guardian } = values;
  if (values.isMinor && isRelationship(guardian.relationship)) {
    const phone = guardian.phone.trim();
    payload.guardian = {
      fullName: guardian.fullName,
      rut: normalizeRut(guardian.rut),
      relationship: guardian.relationship,
      email: guardian.email.trim(),
      ...(phone ? { phone } : {}),
    };
  }
  return payload;
}

interface PublicBookingFormProps {
  therapistId: string;
  slotStart: string;
  onSuccess: (confirmation: BookingConfirmation) => void;
  onSlotTaken: () => void;
  // issue #157: origen ya derivado por PublicBookingPage.tsx (utm_source +
  // document.referrer) -- el form solo lo reenvía tal cual en el payload de
  // reserva, sin recalcularlo.
  origin?: PublicBookingOrigin;
}

export default function PublicBookingForm({
  therapistId,
  slotStart,
  onSuccess,
  onSlotTaken,
  origin,
}: PublicBookingFormProps) {
  const [submitError, setSubmitError] = useState('');
  const bookSlot = useBookPublicSlot(therapistId);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<PublicBookingFormValues>({
    resolver: zodResolver(publicBookingFormSchema),
    defaultValues: {
      isMinor: false,
      fullName: '',
      rut: '',
      birthDate: '',
      email: '',
      guardian: { fullName: '', rut: '', relationship: '', email: '', phone: '' },
    },
  });
  const isMinor = useWatch({ control, name: 'isMinor' });

  const onSubmit = async (values: PublicBookingFormValues) => {
    setSubmitError('');
    try {
      const confirmation = await bookSlot.mutateAsync(buildPayload(values, slotStart, origin));
      onSuccess(confirmation);
    } catch (err) {
      // spec.md "Stale cached slot is rejected at write time" + design.md
      // "Identity resolution gotchas": el 409 es uniforme y nunca revela si
      // fue por slot ocupado o identidad ambigua -- acá se delega en
      // onSlotTaken (el padre refresca la disponibilidad real) en vez de
      // mostrar un mensaje de error genérico.
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        onSlotTaken();
        return;
      }
      setSubmitError(getApiErrorMessage(err, 'No se pudo completar la reserva.'));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="border-t border-slate-100 pt-6 space-y-4">
      <p className="font-display text-lg text-slate-900">
        {isMinor ? 'Datos del paciente' : 'Tus datos'}
      </p>
      <label htmlFor="booking-isMinor" className="flex items-center gap-2 text-sm text-slate-700">
        <input
          id="booking-isMinor"
          type="checkbox"
          className="h-4 w-4 accent-sage-600"
          {...register('isMinor')}
        />
        Reservo para un menor de edad
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          id="booking-fullName"
          label={isMinor ? 'Nombre completo del paciente' : 'Nombre completo'}
          required
          error={errors.fullName?.message}
        >
          <input id="booking-fullName" className="input-field" {...register('fullName')} />
        </FormField>
        <FormField
          id="booking-rut"
          label={isMinor ? 'RUT del paciente' : 'RUT'}
          required
          error={errors.rut?.message}
        >
          <input
            id="booking-rut"
            className="input-field"
            placeholder="12.345.678-9"
            {...register('rut')}
          />
        </FormField>
        <FormField
          id="booking-birthDate"
          label={isMinor ? 'Fecha de nacimiento del paciente' : 'Fecha de nacimiento'}
          required
          error={errors.birthDate?.message}
        >
          <input id="booking-birthDate" type="date" className="input-field" {...register('birthDate')} />
        </FormField>
        <FormField
          id="booking-email"
          label={isMinor ? 'Correo del paciente (opcional)' : 'Email'}
          required={!isMinor}
          error={errors.email?.message}
        >
          <input id="booking-email" type="email" className="input-field" {...register('email')} />
        </FormField>
      </div>

      {isMinor && (
        <fieldset className="rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Datos del representante legal
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              id="booking-guardian-fullName"
              label="Nombre completo del representante"
              required
              error={errors.guardian?.fullName?.message}
            >
              <input
                id="booking-guardian-fullName"
                className="input-field"
                {...register('guardian.fullName')}
              />
            </FormField>
            <FormField
              id="booking-guardian-rut"
              label="RUT del representante"
              required
              error={errors.guardian?.rut?.message}
            >
              <input
                id="booking-guardian-rut"
                className="input-field"
                placeholder="12.345.678-9"
                {...register('guardian.rut')}
              />
            </FormField>
            <FormField
              id="booking-guardian-relationship"
              label="Relación con el paciente"
              required
              error={errors.guardian?.relationship?.message}
            >
              <select
                id="booking-guardian-relationship"
                className="input-field"
                {...register('guardian.relationship')}
              >
                <option value="">Selecciona una opción</option>
                {RELATIONSHIP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              id="booking-guardian-email"
              label="Correo del representante"
              required
              error={errors.guardian?.email?.message}
            >
              <input
                id="booking-guardian-email"
                type="email"
                className="input-field"
                {...register('guardian.email')}
              />
            </FormField>
            <FormField
              id="booking-guardian-phone"
              label="Teléfono del representante (opcional)"
              error={errors.guardian?.phone?.message}
            >
              <input
                id="booking-guardian-phone"
                type="tel"
                className="input-field"
                {...register('guardian.phone')}
              />
            </FormField>
          </div>
        </fieldset>
      )}

      <p data-testid="booking-privacy-note" className="text-xs text-slate-500">
        <strong className="font-semibold text-slate-600">Privacidad.</strong> Usamos los datos que
        ingresas (los tuyos o, si reservas por un menor, los del paciente y los de su representante
        legal: nombre, RUT, fecha de nacimiento y correo) solo para gestionar la reserva y la
        atención. Los recibe tu terapeuta. Más información en nuestra{' '}
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-sage-700 underline ${LINK_FOCUS_RING}`}
        >
          política de privacidad
        </a>
        .
      </p>

      {submitError && <ErrorBanner message={submitError} />}

      <button
        type="submit"
        disabled={bookSlot.isPending}
        className="btn-primary w-full sm:w-auto min-h-11 disabled:opacity-50"
      >
        {bookSlot.isPending ? 'Reservando...' : 'Confirmar reserva'}
      </button>
    </form>
  );
}
