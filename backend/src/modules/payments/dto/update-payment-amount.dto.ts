import { IsInt, Min } from 'class-validator';

// design.md "REST" table: PATCH /payments/:groupId -- per-session amount
// override while the charge is PENDING (payments.service.ts.updateAmount,
// PR 1). Never part of the clinical "Correct session" modal (design.md).
export class UpdatePaymentAmountDto {
  @IsInt()
  @Min(0)
  amount: number;
}
