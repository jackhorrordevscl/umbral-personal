import { IsInt, Max, Min } from 'class-validator';
import { MAX_AMOUNT_CLP } from '../payments.constants';

// design.md "REST" table: PATCH /payments/:groupId -- per-session amount
// override while the charge is PENDING (payments.service.ts.updateAmount,
// PR 1). Never part of the clinical "Correct session" modal (design.md).
export class UpdatePaymentAmountDto {
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CLP)
  amount: number;
}
