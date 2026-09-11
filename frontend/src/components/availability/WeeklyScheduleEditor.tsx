import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import ErrorBanner from '../ui/ErrorBanner';
import { getApiErrorMessage } from '../../utils/api-error';
import { isValidTimeString, minutesToTime, timeToMinutes } from '../../utils/availability';
import { useSaveSchedule, useSchedule } from '../../hooks/useAvailability';

// sdd/patient-self-scheduling PR 4 (tasks.md 4.1, therapist-availability
// Req: Weekly Recurring Schedule / Per-Therapist Session Duration): grilla
// semanal 1=lunes..7=domingo (ISO, mismo criterio que TherapistAvailability
// del backend) + sessionDurationMinutes, wireados a PUT /availability/schedule
// (design.md Decision 8 -- ambos se guardan atómicamente en el mismo body).
const DAY_LABELS: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};
const DAYS = [1, 2, 3, 4, 5, 6, 7];

// spec.md "Invalid time range is rejected": startTime debe ser estrictamente
// anterior a endTime -- el refine vive en el propio entry (path: ['endTime'])
// así el mensaje aparece junto al campo que hay que corregir.
// z.number() en vez de z.coerce.number(): dayOfWeek nunca viene de un input
// de texto (se fija al hacer click en "+ Agregar horario" de un día), y
// sessionDurationMinutes usa `valueAsNumber` en su register() -- así el tipo
// de entrada y salida del schema coinciden y useForm<ScheduleFormValues> no
// necesita el par de genéricos input/output de zodResolver.
const scheduleEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string().refine(isValidTimeString, 'Hora inválida'),
    endTime: z.string().refine(isValidTimeString, 'Hora inválida'),
  })
  .refine((entry) => timeToMinutes(entry.startTime) < timeToMinutes(entry.endTime), {
    message: 'La hora de término debe ser posterior a la de inicio',
    path: ['endTime'],
  });

const scheduleFormSchema = z.object({
  sessionDurationMinutes: z.number().int().min(1, 'Debe ser al menos 1 minuto'),
  entries: z.array(scheduleEntrySchema),
});

type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export default function WeeklyScheduleEditor() {
  const { data: schedule, isLoading } = useSchedule();
  const saveSchedule = useSaveSchedule();
  const [successMessage, setSuccessMessage] = useState('');
  const [submitError, setSubmitError] = useState('');

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: { sessionDurationMinutes: 50, entries: [] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'entries' });

  // El grid siempre manda el estado completo (design.md "Slot grid" +
  // AvailabilityService.saveSchedule: reemplazo total, no diffing) -- una vez
  // que llega el horario guardado, reset() sincroniza el form sin un ciclo
  // extra de render manual (react-hook-form maneja la sincronización, no
  // react-hooks/set-state-in-effect: reset() no es setState de este
  // componente).
  useEffect(() => {
    if (!schedule) return;
    reset({
      sessionDurationMinutes: schedule.sessionDurationMinutes,
      entries: schedule.entries.map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        startTime: minutesToTime(entry.startMinute),
        endTime: minutesToTime(entry.endMinute),
      })),
    });
  }, [schedule, reset]);

  const onSubmit = async (values: ScheduleFormValues) => {
    setSuccessMessage('');
    setSubmitError('');
    try {
      await saveSchedule.mutateAsync({
        sessionDurationMinutes: values.sessionDurationMinutes,
        entries: values.entries.map((entry) => ({
          dayOfWeek: entry.dayOfWeek,
          startMinute: timeToMinutes(entry.startTime),
          endMinute: timeToMinutes(entry.endTime),
        })),
      });
      setSuccessMessage('Horario guardado correctamente.');
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, 'No se pudo guardar el horario.'));
    }
  };

  return (
    <div className="card max-w-2xl mb-6">
      <div className="mb-6">
        <h3 className="font-medium text-slate-800">Horario semanal</h3>
        <p className="text-xs text-slate-500">
          Define tus bloques de disponibilidad recurrente y la duración de cada sesión.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Cargando horario...</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label
              htmlFor="schedule-sessionDurationMinutes"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Duración de sesión (minutos)
            </label>
            <input
              {...register('sessionDurationMinutes', { valueAsNumber: true })}
              id="schedule-sessionDurationMinutes"
              type="number"
              min={1}
              className="input-field max-w-[10rem]"
            />
            {errors.sessionDurationMinutes && (
              <p className="text-red-500 text-xs mt-1">
                {errors.sessionDurationMinutes.message}
              </p>
            )}
          </div>

          <div className="space-y-4">
            {DAYS.map((day) => {
              const dayFields = fields
                .map((field, index) => ({ field, index }))
                .filter(({ field }) => field.dayOfWeek === day);

              return (
                <div key={day} className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-700">{DAY_LABELS[day]}</p>
                    <button
                      type="button"
                      onClick={() =>
                        append({ dayOfWeek: day, startTime: '09:00', endTime: '10:00' })
                      }
                      aria-label={`Agregar horario para ${DAY_LABELS[day]}`}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      + Agregar horario
                    </button>
                  </div>
                  {dayFields.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin horario</p>
                  ) : (
                    <div className="space-y-2">
                      {dayFields.map(({ field, index }) => (
                        <div key={field.id} className="flex items-center gap-2 flex-wrap">
                          <input
                            {...register(`entries.${index}.startTime`)}
                            type="time"
                            aria-label={`${DAY_LABELS[day]} hora de inicio ${index}`}
                            className="input-field w-32"
                          />
                          <span className="text-slate-400 text-sm">a</span>
                          <input
                            {...register(`entries.${index}.endTime`)}
                            type="time"
                            aria-label={`${DAY_LABELS[day]} hora de término ${index}`}
                            className="input-field w-32"
                          />
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            aria-label={`Quitar horario de ${DAY_LABELS[day]} ${index}`}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            Quitar
                          </button>
                          {errors.entries?.[index]?.endTime && (
                            <p className="text-red-500 text-xs w-full">
                              {errors.entries[index]?.endTime?.message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {successMessage && <ErrorBanner variant="success" message={successMessage} />}
          {submitError && <ErrorBanner message={submitError} />}

          <button
            type="submit"
            disabled={saveSchedule.isPending}
            className="btn-primary disabled:opacity-50"
          >
            {saveSchedule.isPending ? 'Guardando...' : 'Guardar horario'}
          </button>
        </form>
      )}
    </div>
  );
}
