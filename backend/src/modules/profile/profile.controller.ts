import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
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

  @Patch()
  update(@Body() dto: UpdateProfileDto, @CurrentUser() user: RequestUser) {
    return this.profileService.update(user.id, dto);
  }
}
