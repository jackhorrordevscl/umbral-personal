import { IsString, MaxLength, MinLength } from 'class-validator';

// design.md "The confirmation callback is a signal, never a source of
// truth": Flow's public POST only carries `token` -- but the design requires
// verifying the callback's HMAC-SHA256 signature BEFORE trusting anything
// (same criterion as "the callback POST is signed the same way as every
// other Flow request"), so `s` also travels in the body.
// MaxLength is the first line of defense against oversized bodies
// (T7.10) -- they're rejected here, at the DTO layer, BEFORE the controller
// ever invokes verifyCallbackSignature or any Prisma read.
// The global ValidationPipe (whitelist + forbidNonWhitelisted, main.ts)
// also rejects any field not declared here -- covering the "extra
// param" case with no extra logic in the controller.
export class ConfirmPaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  s: string;
}
