import { useQuery } from '@tanstack/react-query';
import * as consultationsApi from '../api/consultations';

// PR4 (session-calendar-view, design.md "Data Flow"): queryKey anidado bajo
// ['consultations', ...] a propósito -- la invalidación existente de
// useCreateConsultation (queryKey: ['consultations']) ya refresca el grid
// del calendario cuando se agenda una sesión nueva, sin wiring extra
// (design.md "Decision" en la sección Data Flow).
export function useCalendarSessions(from: string, to: string) {
  return useQuery({
    queryKey: ['consultations', 'range', from, to],
    queryFn: () => consultationsApi.listConsultationsByRange(from, to),
  });
}
