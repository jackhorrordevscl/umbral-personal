import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

// Mismo criterio que DocumentsController.upload (issue #51): solo formatos
// de imagen reales, 5MB (una foto de perfil, no un documento) -- sin
// `storage` explícito, FileInterceptor bufferiza en memoria, no en disco.
const AVATAR_ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  @Get()
  findOne(@CurrentUser() user: RequestUser) {
    return this.profileService.findOne(user.id);
  }

  @Get('mfa-history')
  getMfaHistory(@CurrentUser() user: RequestUser) {
    return this.profileService.getMfaHistory(user.id);
  }

  // Issue #76: throttler nombrado propio ('profile-update', keyed por
  // user id -- ver buildProfileThrottlerOptions en profile.module.ts), NO
  // por IP: varios profesionales detrás de la misma IP (misma clínica/VPN)
  // no deben compartir presupuesto de intentos, y JwtAuthGuard (a nivel de
  // clase) ya corrió antes de este guard de método, así que req.user.id
  // está disponible. @SkipThrottle salta el otro throttler nombrado de este
  // módulo ('email-change-confirm'), mismo patrón que AuthController.
  @UseGuards(ThrottlerGuard)
  // sdd/patient-self-scheduling PR 3 (fix post-verify): ThrottlerModule es
  // @Global(), así que 'public-availability'/'public-booking' (registrados
  // en auth.module.ts) también aplican acá salvo que se salteen.
  @SkipThrottle({
    'email-change-confirm': true,
    'public-availability': true,
    'public-booking': true,
  })
  @Patch()
  update(@Body() dto: UpdateProfileDto, @CurrentUser() user: RequestUser) {
    return this.profileService.update(user.id, dto);
  }

  // Comparte el throttler nombrado 'profile-update' (mismo criterio que
  // PATCH /profile arriba): no es un endpoint público, y subir una foto no
  // es un vector de abuso distinto al resto de este controller.
  @UseGuards(ThrottlerGuard)
  // sdd/patient-self-scheduling PR 3 (fix post-verify): ThrottlerModule es
  // @Global(), así que 'public-availability'/'public-booking' (registrados
  // en auth.module.ts) también aplican acá salvo que se salteen.
  @SkipThrottle({
    'email-change-confirm': true,
    'public-availability': true,
    'public-booking': true,
  })
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (req, file, cb) => {
        if (AVATAR_ALLOWED_MIMETYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF'),
            false,
          );
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    return this.profileService.uploadAvatar(user.id, file);
  }

  @Get('avatar')
  async getAvatar(@CurrentUser() user: RequestUser, @Res() res: Response) {
    const { buffer, mimeType } = await this.profileService.getAvatar(user.id);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // Mismo throttler compartido que PATCH / y POST /avatar (criterio arriba):
  // quitar la foto no es un endpoint público ni un vector de abuso distinto.
  @UseGuards(ThrottlerGuard)
  // sdd/patient-self-scheduling PR 3 (fix post-verify): ThrottlerModule es
  // @Global(), así que 'public-availability'/'public-booking' (registrados
  // en auth.module.ts) también aplican acá salvo que se salteen.
  @SkipThrottle({
    'email-change-confirm': true,
    'public-availability': true,
    'public-booking': true,
  })
  @Delete('avatar')
  deleteAvatar(@CurrentUser() user: RequestUser) {
    return this.profileService.deleteAvatar(user.id);
  }
}
