import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
} from 'class-validator';
import {
  DischargeDeliveryChannel,
  DischargeRecipientType,
} from '@prisma/client';
import { OptionalShortText } from './discharge-fields';

export const DELIVERY_LIMITS = {
  recipientName: 120,
  purpose: 200,
} as const;

// Sin caracteres de control (incluye saltos de línea): texto breve.
/* eslint-disable no-control-regex */
const NO_CONTROL_CHARS = /^[^\u0000-\u001F\u007F]*$/;
/* eslint-enable no-control-regex */

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Registro de una entrega del informe de alta (T4). Qué campos corresponden a
// cada tipo de destinatario lo valida el servicio:
// - PATIENT: sin otros datos de destinatario.
// - GUARDIAN: guardianId obligatorio; el nombre se toma del representante.
// - THIRD_PARTY: recipientName y authorizationDocumentId obligatorios.
// Nada de deliveredAt, recordedById ni dischargeId: la whitelist global
// (forbidNonWhitelisted) los rechaza.
export class CreateDischargeDeliveryDto {
  @IsEnum(DischargeRecipientType)
  recipientType: DischargeRecipientType;

  @OptionalShortText(DELIVERY_LIMITS.recipientName)
  recipientName?: string | null;

  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @IsOptional()
  @IsUUID()
  authorizationDocumentId?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(DELIVERY_LIMITS.purpose)
  @Matches(NO_CONTROL_CHARS, {
    message: 'No puede contener caracteres de control',
  })
  purpose: string;

  @IsEnum(DischargeDeliveryChannel)
  channel: DischargeDeliveryChannel;
}
