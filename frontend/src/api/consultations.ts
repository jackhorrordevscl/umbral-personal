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
