import api from './client';
import type { Consultation } from '../types/patient';

export interface ConsultationStats {
  total: number;
  upcoming: number;
}

export function getConsultationStats() {
  return api.get<ConsultationStats>('/consultations/stats').then((r) => r.data);
}

export interface ConsultationPayload {
  sessionDate: string;
  consultReason: string;
  intervention: string;
  agreements: string;
  nextSessionDate?: string;
  sessionType: string;
}

export interface CreateConsultationPayload extends ConsultationPayload {
  patientId: string;
}

export function listConsultationsByPatient(patientId: string) {
  return api
    .get<Consultation[]>(`/consultations/patient/${patientId}`)
    .then((r) => r.data);
}

export function createConsultation(data: CreateConsultationPayload) {
  return api.post<Consultation>('/consultations', data).then((r) => r.data);
}

export function correctConsultation(id: string, data: ConsultationPayload) {
  return api
    .patch<Consultation>(`/consultations/${id}/correct`, data)
    .then((r) => r.data);
}

// PR4 (session-calendar-view, design.md "Interfaces / Contracts"): mismo
// shape que devuelve GET /consultations/range en el backend
// (ConsultationsService.CalendarSession) -- el payload del grid excluye
// consultReason/intervention/agreements/history a propósito (design.md
// "Decision: Grid payload excludes clinical narrative").
export interface CalendarSession {
  id: string;
  groupId: string;
  sessionDate: string;
  sessionType: 'IN_PERSON' | 'TELEMED';
  patientId: string;
  patientName: string;
  calendarSync: 'SYNCED' | 'FAILED' | null;
}

export function listConsultationsByRange(from: string, to: string) {
  return api
    .get<CalendarSession[]>('/consultations/range', { params: { from, to } })
    .then((r) => r.data);
}
