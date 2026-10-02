import { IsString, MaxLength } from 'class-validator';

export class ConfirmEmailChangeDto {
  @IsString()
  @MaxLength(2048)
  token: string;
}
