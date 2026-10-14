import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { PersonName } from '../../../common/validators/person-name.decorator';
import { IsRut } from '../../../common/validators/is-rut.decorator';
import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  IsUrl,
  MinLength,
  MaxLength,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @NormalizedEmail()
  email?: string;

  @IsOptional()
  @PersonName(200)
  @MinLength(1)
  name?: string;

  // Issue #155: perfil público mostrado en la autoagenda (PublicBookingPage)
  // -- 500 caracteres alcanza para una bio corta sin habilitar abuso (spam,
  // payloads grandes) en un campo que termina expuesto sin autenticación vía
  // GET /public/therapists/:id/profile.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  specialty?: string;

  // Sitio web del terapeuta, expuesto sin autenticación en el perfil público.
  // Solo http/https con protocolo explícito (rechaza javascript:, data:, etc.).
  // '' (o solo espacios) es válido y borra el campo; ValidateIf evita que
  // IsUrl rechace ese string vacío.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_obj, value) => value !== '')
  @IsString()
  @MaxLength(200)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  website?: string;

  // RUT del propio profesional, para firmar informes de alta. No es público.
  // '' (o solo espacios) es válido y borra el campo; ValidateIf evita que
  // IsRut rechace ese string vacío. El servicio lo guarda normalizado.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_obj, value) => value !== '')
  @IsRut()
  rut?: string;

  // Registro profesional (texto libre, ej. N° en la Superintendencia de
  // Salud). No es público. '' limpia el campo; sin caracteres de control.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(50)
  @Matches(/^[^\p{Cc}]*$/u, {
    message: 'El registro profesional contiene caracteres no válidos',
  })
  professionalRegistration?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  // Issue #76: step-up auth. Obligatoria (chequeado en ProfileService, no acá
  // -- class-validator no puede expresar "requerido solo si email o password
  // vienen presentes") cuando la request trae `email` y/o `password`; los
  // updates de solo `name` no la necesitan.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;
}
