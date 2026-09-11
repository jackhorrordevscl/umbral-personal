import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import ErrorBanner from '../ui/ErrorBanner';
import FormField from '../ui/FormField';
import { getApiErrorMessage } from '../../utils/api-error';
import { normalizeRut, validateRut } from '../../utils/rut';
import { useBookPublicSlot } from '../../hooks/usePublicScheduling';
import type { BookingConfirmation } from '../../api/publicScheduling';

// sdd/patient-self-scheduling PR 5 (tasks.md 5.3, design.md "Identity
// resolution gotchas"): formulario REDUCIDO -- solo los campos que
// PublicBookingPatientDto exige para identidad (fullName, rut, birthDate,
// email); a diferencia de PatientForm (ficha completa del terapeuta) omite a
// propósito defaultSessionAmount y documentos/consentimientos legales, que
// ese DTO ni siquiera acepta. rut reusa el mismo validador que PatientForm
// (utils/rut.ts), sin duplicar el algoritmo de dígito verificador.
const publicBookingFormSchema = z.object({
  fullName: z.string().min(1, 'El nombre es obligatorio'),
  rut: z.string().refine(validateRut, 'RUT inválido'),
  birthDate: z.string().min(1, 'La fecha de nacimiento es obligatoria'),
  email: z.string().min(1, 'El email es obligatorio').email('Email inválido'),
});

type PublicBookingFormValues = z.infer<typeof publicBookingFormSchema>;

interface PublicBookingFormProps {
  therapistId: string;
  slotStart: string;
  onSuccess: (confirmation: BookingConfirmation) => void;
  onSlotTaken: () => void;
}

export default function PublicBookingForm({
  therapistId,
  slotStart,
  onSuccess,
  onSlotTaken,
}: PublicBookingFormProps) {
  const [submitError, setSubmitError] = useState('');
  const bookSlot = useBookPublicSlot(therapistId);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PublicBookingFormValues>({
    resolver: zodResolver(publicBookingFormSchema),
    defaultValues: { fullName: '', rut: '', birthDate: '', email: '' },
  });

  const onSubmit = async (values: PublicBookingFormValues) => {
    setSubmitError('');
    try {
      const confirmation = await bookSlot.mutateAsync({
        slotStart,
        patient: { ...values, rut: normalizeRut(values.rut) },
      });
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
    <form onSubmit={handleSubmit(onSubmit)} className="border-t border-slate-100 pt-4 space-y-4">
      <p className="text-sm font-medium text-slate-700">Tus datos</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField id="booking-fullName" label="Nombre completo" required error={errors.fullName?.message}>
          <input id="booking-fullName" className="input-field" {...register('fullName')} />
        </FormField>
        <FormField id="booking-rut" label="RUT" required error={errors.rut?.message}>
          <input
            id="booking-rut"
            className="input-field"
            placeholder="12.345.678-9"
            {...register('rut')}
          />
        </FormField>
        <FormField
          id="booking-birthDate"
          label="Fecha de nacimiento"
          required
          error={errors.birthDate?.message}
        >
          <input id="booking-birthDate" type="date" className="input-field" {...register('birthDate')} />
        </FormField>
        <FormField id="booking-email" label="Email" required error={errors.email?.message}>
          <input id="booking-email" type="email" className="input-field" {...register('email')} />
        </FormField>
      </div>

      {submitError && <ErrorBanner message={submitError} />}

      <button type="submit" disabled={bookSlot.isPending} className="btn-primary disabled:opacity-50">
        {bookSlot.isPending ? 'Reservando...' : 'Confirmar reserva'}
      </button>
    </form>
  );
}
