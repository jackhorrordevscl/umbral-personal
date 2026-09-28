import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Confirmed against two real Flow calls (2026-09 sandbox and production,
// same rejection both times): the confirmation POST to urlConfirmation
// carries ONLY `token`, never a signature. `s` was required here on the
// mistaken assumption that Flow signs the callback the same way it signs
// outgoing requests -- with forbidNonWhitelisted (main.ts) that made every
// real confirmation fail validation before the controller ever ran. Trust
// instead comes from PaymentsController.confirm re-querying getOrderStatus
// with OUR OWN signed request (design.md "The confirmation callback is a
// signal, never a source of truth") -- the callback is never trusted on its
// own. `s` stays declared (optional) only so a body that does include it
// isn't rejected outright by forbidNonWhitelisted; it is never read.
// MaxLength is the first line of defense against oversized bodies
// (T7.10) -- they're rejected here, at the DTO layer, before any Prisma
// read.
export class ConfirmPaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  s?: string;
}
