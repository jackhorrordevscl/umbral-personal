import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PublicTherapistProfileService } from './public-therapist-profile.service';
import { PublicScheduleThrottlerGuard } from './public-schedule-throttler.guard';
import { FOREIGN_THROTTLER_NAMES } from './public-scheduling.controller';

// Issue #155: prefijo propio (sin `/availability`) a propósito -- estas dos
// rutas no pertenecen al recurso de disponibilidad de
// PublicSchedulingController, aunque comparten el mismo :therapistId público
// y el mismo guard de throttling (getPublicScheduleTracker ya lee
// req.params.therapistId de forma genérica, no acoplado a `/availability`).
//
// Reusa el bucket 'public-availability' (igual que getCheckout en
// PublicSchedulingController) en vez de registrar un throttler nombrado
// propio: es otra lectura pública sin efectos secundarios, y un tercer
// nombre global (ThrottlerModule es @Global()) obligaría a agregar
// @SkipThrottle en rutas de otros módulos que hoy no lo necesitan.
@Controller('public/therapists/:therapistId')
export class PublicTherapistProfileController {
  constructor(
    private readonly publicTherapistProfileService: PublicTherapistProfileService,
  ) {}

  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({ ...FOREIGN_THROTTLER_NAMES, 'public-booking': true })
  @Get('profile')
  getProfile(@Param('therapistId') therapistId: string) {
    return this.publicTherapistProfileService.getProfile(therapistId);
  }

  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({ ...FOREIGN_THROTTLER_NAMES, 'public-booking': true })
  @Get('avatar')
  async getAvatar(
    @Param('therapistId') therapistId: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } =
      await this.publicTherapistProfileService.getAvatar(therapistId);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
      // Helmet aplica `Cross-Origin-Resource-Policy: same-origin` por defecto
      // (main.ts), lo que bloquea un <img src> cargado desde otro origen
      // (frontend en Vercel, backend en Render) aunque la respuesta sea 200 --
      // el navegador la descarta con ERR_BLOCKED_BY_RESPONSE.NotSameOrigin.
      // Esta ruta es pública por diseño y se consume vía <img>, así que se
      // relaja solo acá, sin bajar la protección global de Helmet.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(buffer);
  }
}
