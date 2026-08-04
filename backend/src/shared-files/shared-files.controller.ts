import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SharedFilesService } from './shared-files.service';
import { UploadSharedFileDto } from './dto/upload-shared-file.dto';
import { UpdateSharedFileDto } from './dto/update-shared-file.dto';
import { FindAllSharedFilesDto } from './dto/find-all-shared-files.dto';

interface AuthUser {
  id: string;
}

@Controller('shared-files')
@UseGuards(JwtAuthGuard)
export class SharedFilesController {
  constructor(private readonly sharedFilesService: SharedFilesService) {}

  @Get()
  findAll(
    @Query() query: FindAllSharedFilesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sharedFilesService.findAll(user.id, query.category);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sharedFilesService.findOne(id, user.id);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const file = await this.sharedFilesService.findOne(id, user.id);
    const filePath = await this.sharedFilesService.getFilePath(id, user.id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader('Content-Type', file.mimetype);
    res.sendFile(filePath);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadSharedFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sharedFilesService.uploadFile(file, dto, user.id);
  }

  @Patch(':id')
  updateFile(
    @Param('id') id: string,
    @Body() dto: UpdateSharedFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sharedFilesService.updateFile(id, dto, user.id);
  }

  @Delete(':id')
  deleteFile(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sharedFilesService.deleteFile(id, user.id);
  }
}
