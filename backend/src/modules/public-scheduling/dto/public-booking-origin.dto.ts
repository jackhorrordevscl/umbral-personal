import { IsOptional, IsString, MaxLength } from 'class-validator';

// issue #157: origen de adquisición capturado en el frontend al montar
// PublicBookingPage.tsx (document.referrer + utm_source) y enviado junto al
// resto del payload de reserva pública. Ambos campos son opcionales -- un
// paciente que llega sin referrer ni UTM simplemente no trae origen, y
// PatientsService.resolveForPublicBooking() lo etiqueta como "directo".
export class PublicBookingOriginDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;
}
