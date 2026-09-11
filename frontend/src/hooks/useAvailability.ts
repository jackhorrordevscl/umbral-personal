import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as availabilityApi from '../api/availability';

// sdd/patient-self-scheduling PR 4: mismo patrón que usePatients.ts --
// queryKey compartida entre WeeklyScheduleEditor/BlockoutEditor, invalidada
// tras cada mutación exitosa para reflejar el estado real del backend (que
// además invalida su propio cache de slots en cada escritura, ver
// AvailabilityService.invalidate).

export function useSchedule() {
  return useQuery({
    queryKey: ['availability', 'schedule'],
    queryFn: availabilityApi.getSchedule,
  });
}

export function useSaveSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: availabilityApi.saveSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', 'schedule'] });
    },
  });
}

export function useBlockouts() {
  return useQuery({
    queryKey: ['availability', 'blockouts'],
    queryFn: availabilityApi.listBlockouts,
  });
}

export function useCreateBlockout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: availabilityApi.createBlockout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', 'blockouts'] });
    },
  });
}

export function useDeleteBlockout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: availabilityApi.deleteBlockout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', 'blockouts'] });
    },
  });
}
