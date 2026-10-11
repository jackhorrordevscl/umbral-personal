import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { DropoutReason } from '@prisma/client';
import {
  CLOSURE_REASONS,
  type ClosureReasonValue,
} from './create-discharge.dto';
import {
  DISCHARGE_LIMITS,
  DateOnly,
  LongText,
  NullableLongText,
  OptionalShortText,
  SessionCountField,
} from './discharge-fields';

// Edición de un borrador. Todos los campos son opcionales (PATCH parcial). Para
// limpiar dropoutReason / dropoutNote / referralDestination / diagnosis se envía
// null. Las reglas cruzadas (T2c) se validan en el servicio sobre el estado
// fusionado.
export class UpdateDischargeDto {
  @IsOptional()
  @IsIn(CLOSURE_REASONS)
  closureReason?: ClosureReasonValue;

  @IsOptional()
  @IsEnum(DropoutReason)
  dropoutReason?: DropoutReason | null;

  @OptionalShortText(DISCHARGE_LIMITS.dropoutNote)
  dropoutNote?: string | null;

  @OptionalShortText(DISCHARGE_LIMITS.referralDestination)
  referralDestination?: string | null;

  @DateOnly()
  admissionDate?: string;

  @DateOnly()
  dischargeDate?: string;

  @SessionCountField()
  sessionCount?: number;

  @LongText(DISCHARGE_LIMITS.consultReason)
  consultReason?: string;

  @NullableLongText(DISCHARGE_LIMITS.diagnosis)
  diagnosis?: string | null;

  @LongText(DISCHARGE_LIMITS.evolutionSummary)
  evolutionSummary?: string;

  @LongText(DISCHARGE_LIMITS.statusAtDischarge)
  statusAtDischarge?: string;

  @LongText(DISCHARGE_LIMITS.recommendations)
  recommendations?: string;
}
