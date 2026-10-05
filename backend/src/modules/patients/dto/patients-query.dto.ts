import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

// issue #290: tamaño de página cuando el cliente no manda pageSize. GET
// /patients ya no devuelve "todo hasta un tope silencioso": siempre responde
// { data, total, page, pageSize } y el cliente pagina con `total`.
export const DEFAULT_PATIENTS_PAGE_SIZE = 50;

// `search` filtra por nombre (contiene, sin distinguir mayúsculas) y por RUT
// (contiene, sobre el RUT normalizado que se guarda en claro: sin puntos,
// "12345678-K"). Otros campos (email, teléfono) no son buscables a propósito.
export class PatientsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
