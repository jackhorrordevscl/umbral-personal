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

  async validate(payload: { sub: string; email: string; role: string; purpose?: string }) {
    // Los JWT de corta duración emitidos para forzar el enrolamiento MFA
    // (purpose: 'mfa-setup', ver AuthService.login/verifySetupToken) o el
    // cambio de contraseña (purpose: 'password-change', ver
    // AuthService.login/verifyPasswordChangeToken) NUNCA deben aceptarse
    // como Bearer token de sesión: solo sirven para sus propios endpoints,
    // que los verifican manualmente con jwtService.verify. Sin este
    // chequeo, esos tokens de 10 minutos podrían usarse para acceder a
    // cualquier ruta protegida por JwtAuthGuard.
    if (payload.purpose === 'mfa-setup' || payload.purpose === 'password-change') {
      throw new UnauthorizedException('Token no autorizado para esta operación');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}