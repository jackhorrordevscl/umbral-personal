import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { PersonName } from '../../../common/validators/person-name.decorator';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @NormalizedEmail()
  email: string;

  // Issue #627: el registro ya no recibe contraseña. Se elige al verificar el
  // correo (ver VerifyEmailDto), así quien no controla la casilla nunca
  // conoce una credencial de la cuenta.
  @PersonName(200)
  @MinLength(1)
  name: string;

  // Issue #124: con SUBSCRIPTIONS_ENFORCED apagado el alta exige un código de
  // invitación (emitido por AuthService.createInvitation). Con el interruptor
  // encendido (issue #611) el registro es abierto y este campo se ignora.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  inviteCode?: string;

  // Issue #611: código promocional compartido (flyer, QR) que otorga un mes de
  // prueba. Opcional; solo se usa con SUBSCRIPTIONS_ENFORCED encendido.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  promoCode?: string;
}
