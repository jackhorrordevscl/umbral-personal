import { BadRequestException } from '@nestjs/common';
import type { DropoutReason, TreatmentStatus } from '@prisma/client';

export interface ClosureFields {
  closureReason: TreatmentStatus;
  dropoutReason: DropoutReason | null;
  dropoutNote: string | null;
  referralDestination: string | null;
}

// T2c: reglas cruzadas entre el motivo de cierre y sus campos asociados. Se
// aplican sobre el estado resultante (borrador ya fusionado con el PATCH), no
// solo sobre lo que envió el cliente, así que un PATCH no puede dejar un
// borrador incoherente. Los topes de largo y los caracteres de control viven
// en los DTO.
export function assertClosureRules(fields: ClosureFields): void {
  if (fields.closureReason === 'ACTIVE') {
    throw new BadRequestException(
      'El motivo de cierre no puede ser "En tratamiento".',
    );
  }

  if (fields.closureReason === 'DROPPED_OUT') {
    if (!fields.dropoutReason) {
      throw new BadRequestException('Debes indicar el motivo de la deserción.');
    }
  } else if (fields.dropoutReason) {
    throw new BadRequestException(
      'El motivo de deserción solo corresponde cuando el cierre es una deserción.',
    );
  }

  if (fields.dropoutNote && fields.dropoutReason !== 'OTHER') {
    throw new BadRequestException(
      'La nota de deserción solo se permite cuando el motivo es "Otro".',
    );
  }

  if (fields.referralDestination && fields.closureReason !== 'REFERRED') {
    throw new BadRequestException(
      'El destino de derivación solo corresponde cuando el cierre es una derivación.',
    );
  }
}
