import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';
import { BlockoutKind } from '@prisma/client';
import { IsAfter } from '../../../common/validators/is-after.validator';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.5, design.md Decision 4
// "Blockout shape"): un intervalo semiabierto [startsAt, endsAt) + kind
// presentacional -- mismo shape que AvailabilityBlockout (schema.prisma).
// @Type(() => Date) + transform:true global (main.ts) convierte el string
// ISO entrante a Date antes de que @IsAfter compare las instancias.
export class CreateBlockoutDto {
  @Type(() => Date)
  @IsDate()
  startsAt: Date;

  @Type(() => Date)
  @IsDate()
  @IsAfter('startsAt', { message: 'endsAt debe ser posterior a startsAt' })
  endsAt: Date;

  @IsEnum(BlockoutKind)
  kind: BlockoutKind;

  @IsOptional()
  @IsString()
  reason?: string;
}
