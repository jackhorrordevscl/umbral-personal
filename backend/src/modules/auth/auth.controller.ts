import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { MfaSetupBeginDto } from './dto/mfa-setup-begin.dto';
import { MfaSetupConfirmDto } from './dto/mfa-setup-confirm.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MfaRecoverDto } from './dto/mfa-recover.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // T4.2 (issue #20): rate limiting en login y en mfa/verify, con throttlers
  // nombrados independientes ('login' / 'mfa-verify' / 'signup', ver
  // buildAuthThrottlerOptions en AuthModule) para que subir el límite de uno
  // no relaje sin querer los otros. @nestjs/throttler aplica TODOS los
  // throttlers registrados a toda ruta guardada por defecto, así que cada
  // ruta saltea los que no le corresponden con @SkipThrottle — sin esto,
  // login también consumiría cupo de 'mfa-verify'/'signup' (y viceversa)
  // además del propio.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
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
  @SkipThrottle({
    login: true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('mfa/verify')
  verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.authService.verifyMfa(dto);
  }

  // Issue #5: signup propio, la única ruta no autenticada que crea una
  // cuenta y dispara un envío de email real. Throttler propio ('signup')
  // para no compartir presupuesto con login/mfa-verify.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  // Sin JwtAuthGuard a propósito, mismo motivo que mfa/setup/*: el usuario
  // todavía no tiene sesión (la cuenta ni siquiera puede loguear hasta
  // verificar). El token firmado (purpose 'email-verify') es lo que protege
  // esta ruta, no el guard. ThrottlerGuard propio (issue #37): sin sesión ni
  // límite de intentos, el token de verificación quedaba expuesto a fuerza
  // bruta igual que login/mfa-verify/signup.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  // Reenvío del link de verificación (compliance: la única salida
  // self-service cuando el primer email de signup se perdió o expiró en 24h,
  // ver resendVerificationEmail en AuthService). Sin JwtAuthGuard a
  // propósito, mismo motivo que verify-email/mfa/setup/*: la cuenta todavía
  // no puede loguear. Throttler propio ('resend-verification') para no
  // compartir presupuesto con signup/verify-email -- de lo contrario alguien
  // podría spamear reenvíos de email consumiendo el cupo de otra ruta sin
  // que ninguna de las dos lo refleje.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
  })
  @Post('verify-email/resend')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto);
  }

  // Sin JwtAuthGuard a propósito: el usuario todavía no tiene sesión durante
  // el enrolamiento MFA forzado (obligatorio para toda cuenta sin MFA
  // configurado). El setupToken (verificado a mano en AuthService) es lo
  // que protege estas rutas, no el guard — ver auth.service.ts para el
  // detalle del hueco de seguridad que esto evita. ThrottlerGuard propio
  // (issue #37): confirm valida un TOTP de 6 dígitos igual que mfa/verify,
  // así que necesita el mismo tipo de límite de intentos; begin y confirm
  // comparten el throttler 'mfa-setup' por ser dos pasos de un mismo flujo.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('mfa/setup/begin')
  beginMfaSetup(@Body() dto: MfaSetupBeginDto) {
    return this.authService.beginMfaSetup(dto.setupToken);
  }

  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('mfa/setup/confirm')
  confirmMfaSetup(@Body() dto: MfaSetupConfirmDto) {
    return this.authService.confirmMfaSetup(dto.setupToken, dto.token);
  }

  // T4.4 (issue #22): sin JwtAuthGuard por el mismo motivo que mfa/setup/*:
  // el usuario todavía no tiene sesión (login le negó el accessToken por
  // mustChangePassword=true). El passwordChangeToken firmado es lo que
  // protege esta ruta, no el guard. ThrottlerGuard propio (issue #37).
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('password/change')
  changePassword(@Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(dto);
  }

  // Issue #50: forgot/reset password self-service. Sin JwtAuthGuard, mismo
  // motivo que verify-email/mfa/setup/*: el usuario todavía no tiene sesión
  // (justo lo que este flujo existe para resolver sin acceso manual a la
  // base de datos). Throttler propio ('password-reset'), mismo criterio que
  // el resto de las rutas sin sesión de este controller.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'mfa-recover': true,
    'resend-verification': true,
  })
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // Issue #50: círculo cerrado de disableMfa (más abajo) -- ahí se exige un
  // TOTP válido del mismo secreto para desactivar MFA, así que perder el
  // dispositivo lo bloqueaba sin salida. Sin JwtAuthGuard a propósito, mismo
  // motivo que password/forgot: el usuario todavía no tiene sesión (MFA
  // deshabilitado bloqueaba justo el paso de mfa/verify). Throttler propio
  // ('mfa-recover'): expone un chequeo de código de recuperación + password,
  // necesita el mismo tipo de límite de intentos que login/mfa-verify.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'resend-verification': true,
  })
  @Post('mfa/recover')
  recoverMfa(@Body() dto: MfaRecoverDto) {
    return this.authService.recoverMfa(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/generate')
  generateMfaSecret(@CurrentUser() user: RequestUser) {
    return this.authService.generateMfaSecret(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  enableMfa(@CurrentUser() user: RequestUser, @Body('token') token: string) {
    return this.authService.enableMfa(user.id, token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  disableMfa(@CurrentUser() user: RequestUser, @Body('token') token: string) {
    return this.authService.disableMfa(user.id, token);
  }
}
