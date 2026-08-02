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
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SharedFilesService } from './shared-files.service';
import type { UploadFileDto } from './shared-files.service';
import { FileCategory } from '@prisma/client';

@Controller('shared-files')
@UseGuards(JwtAuthGuard)
export class SharedFilesController {
  constructor(private readonly sharedFilesService: SharedFilesService) {}

  @Get()
  findAll(@Query('category') category: FileCategory | undefined, @Req() req: any) {
    return this.sharedFilesService.findAll(req.user.id, category);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.sharedFilesService.findOne(id, req.user.id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const file = await this.sharedFilesService.findOne(id, req.user.id);
    const filePath = await this.sharedFilesService.getFilePath(id, req.user.id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader('Content-Type', file.mimetype);
    (res as any).sendFile(filePath);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    dto: { name: string; description?: string; category?: FileCategory },
    @Req() req: any,
  ) {
    return this.sharedFilesService.uploadFile(file, dto, req.user.id);
  }

  @Patch(':id')
  updateFile(
    @Param('id') id: string,
    @Body()
    dto: { name?: string; description?: string; category?: FileCategory },
    @Req() req: any,
  ) {
    return this.sharedFilesService.updateFile(id, dto, req.user.id);
  }

  @Delete(':id')
  deleteFile(@Param('id') id: string, @Req() req: any) {
    return this.sharedFilesService.deleteFile(id, req.user.id);
  }
}
