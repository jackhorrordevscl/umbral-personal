import api from './client';

// sdd/patient-self-scheduling PR 4: tipos y wrappers axios para el editor de
// horarios/bloqueos de Profile -- contrato tomado directo de
// backend/src/modules/availability/availability.controller.ts y sus DTOs
// (schedule-entry.dto.ts, schedule-update.dto.ts, create-blockout.dto.ts,
// PR 2), no adivinado.

export interface ScheduleEntry {
  id?: string;
  dayOfWeek: number; // 1=lunes .. 7=domingo (ISO)
  startMinute: number;
  endMinute: number;
}

export interface Schedule {
  sessionDurationMinutes: number;
  entries: ScheduleEntry[];
}

export interface ScheduleUpdatePayload {
  sessionDurationMinutes: number;
  entries: Array<Pick<ScheduleEntry, 'dayOfWeek' | 'startMinute' | 'endMinute'>>;
}

export type BlockoutKind = 'FULL_DAY' | 'PARTIAL_DAY' | 'DATE_RANGE';

export interface Blockout {
  id: string;
  startsAt: string;
  endsAt: string;
  kind: BlockoutKind;
  reason: string | null;
}

export interface CreateBlockoutPayload {
  startsAt: string;
  endsAt: string;
  kind: BlockoutKind;
  reason?: string;
}

export function getSchedule() {
  return api.get<Schedule>('/availability/schedule').then((r) => r.data);
}

export function saveSchedule(payload: ScheduleUpdatePayload) {
  return api.put<void>('/availability/schedule', payload).then((r) => r.data);
}

export function listBlockouts() {
  return api.get<Blockout[]>('/availability/blockouts').then((r) => r.data);
}

export function createBlockout(payload: CreateBlockoutPayload) {
  return api.post<Blockout>('/availability/blockouts', payload).then((r) => r.data);
}

export function deleteBlockout(id: string) {
  return api.delete(`/availability/blockouts/${id}`);
}
