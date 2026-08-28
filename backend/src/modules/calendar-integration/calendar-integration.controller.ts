import {
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CalendarOauthService } from './calendar-oauth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

// design.md "Decision: OAuth return path is a module constant pointing at
// /security": el panel de Google Calendar vive en SecurityPage tras el split
// de SettingsPage.tsx (PR2a) -- una env var sería un contrato de despliegue
// para lo que en realidad es la forma de una ruta del frontend (un typo acá
// 404earía sin señal de compilación). `/settings` se mantiene además como
// alias en App.tsx (`<Navigate to="/security" replace />`) para que un
// backend viejo en despliegue o un bookmark existente sigan aterrizando bien
// durante el rollout.
const CALENDAR_RETURN_PATH = '/security';

// design.md REST table: GET /status y POST /authorize|disconnect quedan
// scoped al terapeuta autenticado (@CurrentUser(), nunca un :id de ruta) --
// no existe superficie para pedir la conexión de otro terapeuta por id. GET
// /callback es la única ruta pública del módulo (Google redirige el
// navegador; el bearer interceptor de axios no puede participar de un
// redirect cross-origin) y por eso es la superficie de ataque primaria (ver
// CalendarOauthService.verifyAndConsumeState).
@Controller('calendar-integration')
export class CalendarIntegrationController {
  private readonly logger = new Logger(CalendarIntegrationController.name);

  constructor(
    private oauthService: CalendarOauthService,
    private config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus(@CurrentUser() user: RequestUser) {
    return this.oauthService.getStatus(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('authorize')
  authorize(@CurrentUser() user: RequestUser) {
    return this.oauthService.buildAuthorizationUrl(user.id);
  }

  // Sin JwtAuthGuard a propósito (design.md): Google redirige el navegador
  // del usuario acá directo, sin ningún header Authorization. La identidad
  // viaja exclusivamente en `state` (JWT firmado, de un solo uso) --
  // verifyAndConsumeState es lo único que autentica este request.
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;

    try {
      if (!code || !state) {
        throw new Error('code/state ausente en el callback');
      }
      const { therapistId } =
        await this.oauthService.verifyAndConsumeState(state);
      await this.oauthService.exchangeCodeAndPersist(therapistId, code);
      res.redirect(`${frontendUrl}${CALENDAR_RETURN_PATH}?calendar=connected`);
    } catch (err) {
      this.logger.error(
        `Fallo en el callback de Google Calendar: ${err instanceof Error ? err.message : err}`,
      );
      res.redirect(`${frontendUrl}${CALENDAR_RETURN_PATH}?calendar=error`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('disconnect')
  disconnect(@CurrentUser() user: RequestUser) {
    return this.oauthService.disconnect(user.id);
  }
}
