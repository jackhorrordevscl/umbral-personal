import { BadRequestException } from '@nestjs/common';

// Los DTO de edición salen de PartialType, que marca todos los campos con
// IsOptional, y IsOptional omite tanto undefined como null. Un `null`
// explícito en una columna no nula llegaba a Prisma y terminaba en 500; esta
// guarda lo convierte en 400. Las columnas nulables no se listan: ahí null
// significa "borrar el valor".
export function rejectNullFields(
  dto: object,
  nonNullableFields: readonly string[],
): void {
  for (const field of nonNullableFields) {
    if ((dto as Record<string, unknown>)[field] === null) {
      throw new BadRequestException(`El campo ${field} no puede ser null`);
    }
  }
}
