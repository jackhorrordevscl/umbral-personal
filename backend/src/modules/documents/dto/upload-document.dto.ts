import { IsEnum, IsString } from 'class-validator';
import { DocumentType } from '@prisma/client';

// Issue #72 (punto 3): patientId/type llegaban del multipart via
// @Body('patientId')/@Body('type') sin DTO, con un `type as any` en
// DocumentsService que anulaba el chequeo de enum -- un valor inválido caía
// al 500 genérico en vez de un 400 limpio.
export class UploadDocumentDto {
  @IsString()
  patientId: string;

  @IsEnum(DocumentType)
  type: DocumentType;
}
