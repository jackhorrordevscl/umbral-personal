import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

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
  @SkipThrottle({ 'email-change-confirm': true })
  @Patch()
  update(@Body() dto: UpdateProfileDto, @CurrentUser() user: RequestUser) {
    return this.profileService.update(user.id, dto);
  }
}
