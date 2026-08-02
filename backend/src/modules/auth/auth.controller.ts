import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { MfaSetupBeginDto } from './dto/mfa-setup-begin.dto';
import { MfaSetupConfirmDto } from './dto/mfa-setup-confirm.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // T4.2 (issue #20): rate limiting en login y en mfa/verify, con throttlers
  // nombrados independientes ('login' / 'mfa-verify', ver buildAuthThrottlerOptions
  // en AuthModule) para que subir el límite de uno no relaje sin querer el
  // del otro. @nestjs/throttler aplica TODOS los throttlers registrados a
  // toda ruta guardada por defecto, así que cada ruta saltea el que no le
  // corresponde con @SkipThrottle — sin esto, login también consumiría cupo
  // del throttler 'mfa-verify' (y viceversa) además del propio.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ 'mfa-verify': true })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // mfa/verify no puede llevar JwtAuthGuard: es el segundo paso del login
  // (login devuelve requiresMfa + userId antes de emitir ningún JWT), así que
  // por diseño se llama sin sesión. Sin throttling acá, un userId conocido +
  // fuerza bruta sobre el TOTP de 6 dígitos (window:1, ~3 códigos válidos)
  // emitía un JWT real sin ningún límite de intentos.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ login: true })
  @Post('mfa/verify')
  verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.authService.verifyMfa(dto);
  }

  // Sin JwtAuthGuard a propósito: el usuario todavía no tiene sesión en el
  // enrolamiento MFA forzado (rol administrativo sin MFA). El setupToken
  // (verificado a mano en AuthService) es lo que protege estas rutas, no
  // el guard — ver auth.service.ts para el detalle del hueco de seguridad
  // que esto evita.
  @Post('mfa/setup/begin')
  beginMfaSetup(@Body() dto: MfaSetupBeginDto) {
    return this.authService.beginMfaSetup(dto.setupToken);
  }

  @Post('mfa/setup/confirm')
  confirmMfaSetup(@Body() dto: MfaSetupConfirmDto) {
    return this.authService.confirmMfaSetup(dto.setupToken, dto.token);
  }

  // T4.4 (issue #22): sin JwtAuthGuard por el mismo motivo que mfa/setup/*:
  // el usuario todavía no tiene sesión (login le negó el accessToken por
  // mustChangePassword=true). El passwordChangeToken firmado es lo que
  // protege esta ruta, no el guard.
  @Post('password/change')
  changePassword(@Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/generate')
  generateMfaSecret(@CurrentUser() user: any) {
    return this.authService.generateMfaSecret(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  enableMfa(@CurrentUser() user: any, @Body('token') token: string) {
    return this.authService.enableMfa(user.id, token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  disableMfa(@CurrentUser() user: any, @Body('token') token: string) {
    return this.authService.disableMfa(user.id, token);
  }
}
