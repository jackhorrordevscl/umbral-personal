interface PatientsPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

// issue #290: controles de paginación de la lista de pacientes (el backend ya
// no entrega la lista completa). No se renderiza si todo cabe en una página.
export default function PatientsPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: PatientsPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Paginación de pacientes"
      className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2"
    >
      <p className="text-xs text-slate-500" aria-live="polite">
        Mostrando {first}–{last} de {total} · Página {page} de {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
