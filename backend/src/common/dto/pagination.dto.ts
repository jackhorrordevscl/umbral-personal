import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Issue #140: sin page/pageSize, los endpoints paginables devuelven la
// lista completa como antes (issue #48) -- el frontend hoy nunca manda
// estos parámetros y espera un array plano, no { data, total, page,
// pageSize }, así que forzar paginación real rompería ese contrato. Este
// límite es solo una cota de seguridad para ese camino "sin paginar": evita
// que un findMany() sin ningún límite pueda volcar una tabla completa (ver
// PatientsService.findAll / ConsultationsService.findByPatient), sin
// cambiar la forma de la respuesta.
export const UNPAGINATED_SAFETY_LIMIT = 500;

// Opcional y retrocompatible: sin page/pageSize, los endpoints devuelven
// la lista completa como antes (issue #48).
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
