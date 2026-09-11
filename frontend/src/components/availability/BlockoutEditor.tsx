import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import ErrorBanner from '../ui/ErrorBanner';
import { getApiErrorMessage } from '../../utils/api-error';
import { buildLocalISO, formatChileDate } from '../../utils/datetime';
import { addDaysToDateKey, isValidTimeString, timeToMinutes } from '../../utils/availability';
import {
  useBlockouts,
  useCreateBlockout,
  useDeleteBlockout,
} from '../../hooks/useAvailability';
import type { BlockoutKind } from '../../api/availability';

// sdd/patient-self-scheduling PR 4 (tasks.md 4.2, therapist-availability Req:
// Availability Blockouts, design.md Decision 4 "Blockout shape"): un
// bloqueo es un intervalo semiabierto [startsAt, endsAt) + kind
// presentacional -- el editor solo decide CÓMO construir ese intervalo según
// el tipo elegido; el backend lo trata igual sea cual sea el kind.
const KIND_LABELS: Record<BlockoutKind, string> = {
  FULL_DAY: 'Día completo',
  PARTIAL_DAY: 'Horario parcial',
  DATE_RANGE: 'Rango de fechas',
};
const KINDS = Object.keys(KIND_LABELS) as BlockoutKind[];

const blockoutFormSchema = z
  .object({
    kind: z.enum(['FULL_DAY', 'PARTIAL_DAY', 'DATE_RANGE']),
    date: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    reason: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.kind === 'FULL_DAY') {
      if (!values.date) {
        ctx.addIssue({ code: 'custom', message: 'Selecciona una fecha', path: ['date'] });
      }
    }

    if (values.kind === 'PARTIAL_DAY') {
      if (!values.date) {
        ctx.addIssue({ code: 'custom', message: 'Selecciona una fecha', path: ['date'] });
      }
      const startValid = !!values.startTime && isValidTimeString(values.startTime);
      const endValid = !!values.endTime && isValidTimeString(values.endTime);
      if (!startValid) {
        ctx.addIssue({ code: 'custom', message: 'Hora inválida', path: ['startTime'] });
      }
      if (!endValid) {
        ctx.addIssue({ code: 'custom', message: 'Hora inválida', path: ['endTime'] });
      }
      if (
        startValid &&
        endValid &&
        timeToMinutes(values.startTime!) >= timeToMinutes(values.endTime!)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'La hora de término debe ser posterior a la de inicio',
          path: ['endTime'],
        });
      }
    }

    if (values.kind === 'DATE_RANGE') {
      if (!values.startDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'Selecciona una fecha de inicio',
          path: ['startDate'],
        });
      }
      if (!values.endDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'Selecciona una fecha de término',
          path: ['endDate'],
        });
      }
      if (values.startDate && values.endDate && values.startDate > values.endDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'La fecha de término debe ser igual o posterior a la de inicio',
          path: ['endDate'],
        });
      }
    }
  });

type BlockoutFormValues = z.infer<typeof blockoutFormSchema>;

export default function BlockoutEditor() {
  const { data: blockouts, isLoading } = useBlockouts();
  const createBlockout = useCreateBlockout();
  const deleteBlockout = useDeleteBlockout();
  const [submitError, setSubmitError] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BlockoutFormValues>({
    resolver: zodResolver(blockoutFormSchema),
    defaultValues: { kind: 'FULL_DAY' },
  });

  // useWatch (no form.watch): watch() devuelve una función no memoizable que
  // React Compiler no puede optimizar de forma segura (warning
  // react-hooks/incompatible-library) -- useWatch es el hook equivalente
  // compatible, mismo criterio recomendado por react-hook-form.
  const kind = useWatch({ control, name: 'kind' });

  const onSubmit = async (values: BlockoutFormValues) => {
    setSubmitError('');
    let startsAt: string;
    let endsAt: string;

    if (values.kind === 'FULL_DAY') {
      startsAt = buildLocalISO(values.date!, '00:00');
      endsAt = buildLocalISO(addDaysToDateKey(values.date!, 1), '00:00');
    } else if (values.kind === 'PARTIAL_DAY') {
      startsAt = buildLocalISO(values.date!, values.startTime!);
      endsAt = buildLocalISO(values.date!, values.endTime!);
    } else {
      startsAt = buildLocalISO(values.startDate!, '00:00');
      endsAt = buildLocalISO(addDaysToDateKey(values.endDate!, 1), '00:00');
    }

    try {
      await createBlockout.mutateAsync({
        startsAt,
        endsAt,
        kind: values.kind,
        reason: values.reason || undefined,
      });
      reset({ kind: values.kind });
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, 'No se pudo crear el bloqueo.'));
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteError('');
    try {
      await deleteBlockout.mutateAsync(id);
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, 'No se pudo quitar el bloqueo.'));
    }
  };

  return (
    <div className="card max-w-2xl mb-6">
      <div className="mb-6">
        <h3 className="font-medium text-slate-800">Bloqueos de disponibilidad</h3>
        <p className="text-xs text-slate-500">
          Declara días u horarios en los que no atenderás — tienen prioridad sobre tu
          horario semanal.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mb-6">
        <div>
          <label htmlFor="blockout-kind" className="block text-sm font-medium text-slate-700 mb-1">
            Tipo de bloqueo
          </label>
          <select id="blockout-kind" {...register('kind')} className="input-field">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        {kind === 'FULL_DAY' && (
          <div>
            <label htmlFor="blockout-date" className="block text-sm font-medium text-slate-700 mb-1">
              Fecha
            </label>
            <input id="blockout-date" type="date" {...register('date')} className="input-field" />
            {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date.message}</p>}
          </div>
        )}

        {kind === 'PARTIAL_DAY' && (
          <div className="flex gap-3 flex-wrap">
            <div>
              <label htmlFor="blockout-date" className="block text-sm font-medium text-slate-700 mb-1">
                Fecha
              </label>
              <input id="blockout-date" type="date" {...register('date')} className="input-field" />
              {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date.message}</p>}
            </div>
            <div>
              <label htmlFor="blockout-startTime" className="block text-sm font-medium text-slate-700 mb-1">
                Desde
              </label>
              <input
                id="blockout-startTime"
                type="time"
                {...register('startTime')}
                className="input-field"
              />
              {errors.startTime && (
                <p className="text-red-500 text-xs mt-1">{errors.startTime.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="blockout-endTime" className="block text-sm font-medium text-slate-700 mb-1">
                Hasta
              </label>
              <input
                id="blockout-endTime"
                type="time"
                {...register('endTime')}
                className="input-field"
              />
              {errors.endTime && (
                <p className="text-red-500 text-xs mt-1">{errors.endTime.message}</p>
              )}
            </div>
          </div>
        )}

        {kind === 'DATE_RANGE' && (
          <div className="flex gap-3 flex-wrap">
            <div>
              <label htmlFor="blockout-startDate" className="block text-sm font-medium text-slate-700 mb-1">
                Desde
              </label>
              <input
                id="blockout-startDate"
                type="date"
                {...register('startDate')}
                className="input-field"
              />
              {errors.startDate && (
                <p className="text-red-500 text-xs mt-1">{errors.startDate.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="blockout-endDate" className="block text-sm font-medium text-slate-700 mb-1">
                Hasta
              </label>
              <input
                id="blockout-endDate"
                type="date"
                {...register('endDate')}
                className="input-field"
              />
              {errors.endDate && (
                <p className="text-red-500 text-xs mt-1">{errors.endDate.message}</p>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="blockout-reason" className="block text-sm font-medium text-slate-700 mb-1">
            Motivo (opcional)
          </label>
          <input id="blockout-reason" type="text" {...register('reason')} className="input-field" />
        </div>

        {submitError && <ErrorBanner message={submitError} />}

        <button
          type="submit"
          disabled={createBlockout.isPending}
          className="btn-primary disabled:opacity-50"
        >
          {createBlockout.isPending ? 'Guardando...' : 'Agregar bloqueo'}
        </button>
      </form>

      {deleteError && <ErrorBanner message={deleteError} className="mb-4" />}

      {isLoading ? (
        <p className="text-sm text-slate-500">Cargando bloqueos...</p>
      ) : blockouts && blockouts.length > 0 ? (
        <ul className="space-y-2">
          {blockouts.map((blockout) => (
            <li
              key={blockout.id}
              className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"
            >
              <div>
                <p className="text-sm text-slate-700">
                  {KIND_LABELS[blockout.kind]} — {formatChileDate(blockout.startsAt)}
                </p>
                {blockout.reason && (
                  <p className="text-xs text-slate-500">{blockout.reason}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(blockout.id)}
                aria-label={`Quitar bloqueo ${blockout.id}`}
                className="text-red-400 hover:text-red-600 text-xs"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">Sin bloqueos registrados.</p>
      )}
    </div>
  );
}
