import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { ScheduleUpdateDto } from './dto/schedule-update.dto';
import { CreateBlockoutDto } from './dto/create-blockout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.4): CRUD autenticado del
// terapeuta sobre su propia disponibilidad -- mismo criterio que
// ProfileController: el recurso siempre está scopeado a user.id (JWT), nunca
// a un :id de path/query, salvo el sub-recurso blockout (que sí tiene su
// propio id, y cuyo ownership valida AvailabilityService.deleteBlockout).
@UseGuards(JwtAuthGuard)
@Controller('availability')
export class AvailabilityController {
  constructor(private availabilityService: AvailabilityService) {}

  @Get('schedule')
  getSchedule(@CurrentUser() user: RequestUser) {
    return this.availabilityService.getSchedule(user.id);
  }

  @Put('schedule')
  saveSchedule(
    @Body() dto: ScheduleUpdateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.availabilityService.saveSchedule(user.id, dto);
  }

  @Get('blockouts')
  listBlockouts(@CurrentUser() user: RequestUser) {
    return this.availabilityService.listBlockouts(user.id);
  }

  @Post('blockouts')
  createBlockout(
    @Body() dto: CreateBlockoutDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.availabilityService.createBlockout(user.id, dto);
  }

  @Delete('blockouts/:id')
  deleteBlockout(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.availabilityService.deleteBlockout(id, user.id);
  }
}
