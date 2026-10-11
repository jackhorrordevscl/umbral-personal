import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { DropoutReason } from '@prisma/client';
import { DISCHARGE_LIMITS, OptionalShortText } from './discharge-fields';

// Cierres válidos: ACTIVE no es un cierre.
export const CLOSURE_REASONS = [
  'DISCHARGED',
  'REFERRED',
  'DROPPED_OUT',
] as const;
export type ClosureReasonValue = (typeof CLOSURE_REASONS)[number];

// El borrador se crea prellenado desde las consultas; el cliente solo elige el
// tipo de cierre y sus campos asociados. Nada de status, hash, firmante, ids de
// versión ni terapeuta: la whitelist global (forbidNonWhitelisted) los rechaza.
export class CreateDischargeDto {
  @IsIn(CLOSURE_REASONS)
  closureReason: ClosureReasonValue;

  @IsOptional()
  @IsEnum(DropoutReason)
  dropoutReason?: DropoutReason | null;

  @OptionalShortText(DISCHARGE_LIMITS.dropoutNote)
  dropoutNote?: string | null;

  @OptionalShortText(DISCHARGE_LIMITS.referralDestination)
  referralDestination?: string | null;
}
