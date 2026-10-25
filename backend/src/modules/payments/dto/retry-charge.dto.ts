import { IsBoolean, IsOptional } from 'class-validator';

// POST /payments/:groupId/retry-charge -- optional body. Issue #494: after an
// order creation that ended with an unknown outcome, the therapist confirms
// they checked Flow and no order exists for the session before it is re-issued.
export class RetryChargeDto {
  @IsOptional()
  @IsBoolean()
  confirmOrderNotCreated?: boolean;
}
