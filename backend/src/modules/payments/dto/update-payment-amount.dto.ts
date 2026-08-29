import { IsInt, Min } from 'class-validator';

// design.md "REST" table: PATCH /payments/:groupId -- override de monto por
// sesión mientras el cargo está PENDING (payments.service.ts.updateAmount,
// PR 1). Nunca parte del modal clínico "Corregir sesión" (design.md).
export class UpdatePaymentAmountDto {
  @IsInt()
  @Min(0)
  amount: number;
}
