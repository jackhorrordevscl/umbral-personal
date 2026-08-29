import { IsString, MaxLength, MinLength } from 'class-validator';

// design.md "The confirmation callback is a signal, never a source of
// truth": el POST público de Flow solo trae `token` -- pero el diseño exige
// verificar la firma HMAC-SHA256 del callback ANTES de confiar en nada
// (mismo criterio de "the callback POST is signed the same way as every
// other Flow request"), así que `s` también viaja en el body.
// MaxLength es la primera línea de defensa contra bodies sobredimensionados
// (T7.10) -- se rechazan acá, en la capa de DTO, ANTES de que el controller
// llegue a invocar verifyCallbackSignature o cualquier lectura de Prisma.
// El ValidationPipe global (whitelist + forbidNonWhitelisted, main.ts)
// además rechaza cualquier campo no declarado acá -- cubre el caso "extra
// param" sin lógica adicional en el controller.
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
