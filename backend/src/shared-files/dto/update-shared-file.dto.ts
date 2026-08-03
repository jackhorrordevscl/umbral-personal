import { PartialType } from '@nestjs/mapped-types';
import { UploadSharedFileDto } from './upload-shared-file.dto';

export class UpdateSharedFileDto extends PartialType(UploadSharedFileDto) {}
