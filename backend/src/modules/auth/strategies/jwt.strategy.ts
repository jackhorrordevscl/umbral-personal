import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') as string,
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    purpose?: string;
    iat: number;
  }) {
    // Los JWT de corta duración emitidos para forzar el enrolamiento MFA
    // (purpose: 'mfa-setup', ver AuthService.login/verifySetupToken), el
    // cambio de contraseña (purpose: 'password-change', ver
    // AuthService.login/verifyPasswordChangeToken), la verificación de
    // email del signup propio (purpose: 'email-verify', issue #5), el
    // reset self-service de contraseña (purpose: 'password-reset', issue
    // #50) o el `state` del handshake OAuth de Google Calendar (purpose:
    // 'google-calendar-oauth', sdd/google-calendar-integration -- ver
    // CalendarOauthService.buildAuthorizationUrl/verifyAndConsumeState)
    // NUNCA deben aceptarse como Bearer token de sesión: solo sirven para
    // sus propios endpoints, que los verifican manualmente con
    // jwtService.verify. Sin este chequeo, esos tokens podrían usarse para
    // acceder a cualquier ruta protegida por JwtAuthGuard.
    if (
      payload.purpose === 'mfa-setup' ||
      payload.purpose === 'password-change' ||
      payload.purpose === 'email-verify' ||
      payload.purpose === 'password-reset' ||
      payload.purpose === 'google-calendar-oauth'
    ) {
      throw new UnauthorizedException(
        'Token no autorizado para esta operación',
      );
    }

    // select mínimo: este validate corre en cada request autenticado (vía
    // JwtAuthGuard, prácticamente todos los endpoints) y solo se necesitan
    // estos 5 campos -- traer la fila completa movía passwordHash/mfaSecret
    // de más en cada request (issue #34).
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        deletedAt: true,
        passwordChangedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    // Issue #76 (PR B): invalida cualquier token emitido ANTES del último
    // cambio de contraseña (PATCH /profile, resetPassword o el completion de
    // mustChangePassword -- ver AuthService/ProfileService). `iat` es un
    // timestamp en segundos enteros (precision de JWT), mientras que
    // passwordChangedAt tiene precision de milisegundos; comparar con `<=`
    // (no `<`) contra passwordChangedAt "piso"-eado a segundos es necesario
    // porque ningun flujo de este backend emite un token nuevo en el mismo
    // instante en que cambia la contraseña -- con `<` un token emitido en el
    // MISMO segundo (antes, en terminos reales) sobrevivia el cambio,
    // ventana confirmada por los e2e de session-invalidation.e2e-spec.ts.
    // NULL (usuario pre-deploy, o que nunca cambio su contraseña) desactiva
    // el chequeo por completo -- sin esto, la migracion que agrega la
    // columna forzaria un logout retroactivo de TODA la base de usuarios
    // existente.
    if (
      user.passwordChangedAt &&
      payload.iat <= Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException(
        'Sesión expirada por cambio de contraseña',
      );
    }

    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}
