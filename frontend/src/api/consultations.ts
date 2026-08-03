import api from './client';

export interface ConsultationStats {
  total: number;
  upcoming: number;
}

export function getConsultationStats() {
  return api.get<ConsultationStats>('/consultations/stats').then((r) => r.data);
}
