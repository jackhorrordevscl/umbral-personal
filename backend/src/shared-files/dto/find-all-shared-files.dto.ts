import { IsEnum, IsOptional } from 'class-validator';
import { FileCategory } from '@prisma/client';

// Issue #72 (punto 3), mismo motivo que UploadSharedFileDto (issue #38):
// category llegaba como query param crudo directo al `where` de Prisma sin
// pasar por el ValidationPipe -- un valor fuera del enum caía al 500
// genérico en vez de un 400 limpio.
export class FindAllSharedFilesDto {
  @IsOptional()
  @IsEnum(FileCategory)
  category?: FileCategory;
}
