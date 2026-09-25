import { normalizeRut } from './rut';

interface SearchablePatient {
  fullName: string;
  rut: string;
}

// Filtra por nombre o RUT. La búsqueda se normaliza una sola vez en vez de
// por cada paciente evaluado.
export function filterPatients<T extends SearchablePatient>(patients: T[], search: string): T[] {
  const term = search.toLowerCase();
  const rutTerm = normalizeRut(search);
  return patients.filter(
    (p) => p.fullName.toLowerCase().includes(term) || normalizeRut(p.rut).includes(rutTerm),
  );
}
