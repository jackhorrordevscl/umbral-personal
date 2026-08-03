import { IsEnum, IsOptional, IsString } from 'class-validator';
import { FileCategory } from '@prisma/client';

// Issue #38: antes tipado como interfaz TS plana (sin decoradores), así que
// el ValidationPipe global (whitelist/forbidNonWhitelisted/transform) no
// aplicaba ninguna validación real -- `category` podía llegar con cualquier
// string, no solo un valor del enum.
export class UploadSharedFileDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(FileCategory)
  category?: FileCategory;
}
