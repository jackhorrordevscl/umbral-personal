import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { EmailChangeService } from './email-change.service';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';

// Issue #76: sin JwtAuthGuard, mismo motivo que POST /auth/verify-email --
// el token firmado (purpose 'email-change', ver EmailChangeService) ES la
// autoridad acá, no una sesión: el link llega a una casilla nueva que
// todavía no tiene ningún accessToken asociado.
@Controller('profile/email-change')
export class EmailChangeController {
  constructor(private emailChangeService: EmailChangeService) {}

  // sdd/patient-self-scheduling PR 3 (fix post-verify): ThrottlerModule es
  // @Global(), así que 'public-availability'/'public-booking' (registrados
  // en auth.module.ts) también aplican acá salvo que se salteen.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    'profile-update': true,
    'public-availability': true,
    'public-booking': true,
  })
  @Post('confirm')
  confirm(@Body() dto: ConfirmEmailChangeDto) {
    return this.emailChangeService.confirm(dto.token);
  }
}
