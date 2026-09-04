import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentProvider } from '@prisma/client';

// design.md sequence "Connect account — after", step 1 + spec "Guided
// Connection Wizard With Pre-Persistence Validation": the paste step's
// request body -- PaymentAccountService.validate() makes NO Prisma write on
// either success or failure. The format gate here mirrors
// PaymentAccountService's own CREDENTIAL_FORMAT (16-128 chars, Flow's
// documented key alphabet), so an obviously malformed value is rejected at
// the DTO layer, before the request body reaches the service or ever calls
// Flow -- spec "Malformed credentials are rejected before calling Flow".
export class ValidateCredentialsDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'apiKey no tiene el formato esperado por Flow.',
  })
  apiKey: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'secretKey no tiene el formato esperado por Flow.',
  })
  secretKey: string;

  // Optional today (only FLOW is registered) -- proposal.md "Extensible
  // gateway selection": a second provider only needs a new enum value plus a
  // registry entry, never a new DTO field.
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;
}
