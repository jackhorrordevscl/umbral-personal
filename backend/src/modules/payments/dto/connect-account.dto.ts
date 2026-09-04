import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ValidateCredentialsDto } from './validate-credentials.dto';

// design.md sequence "Connect account — after", step 2: same credential
// shape as ValidateCredentialsDto (connect() re-validates independently --
// the wizard's earlier validate() call is never trusted as proof by itself)
// plus the optional therapist-typed label. displayName is only the
// fallback the confirmation step shows when Flow's response does not expose
// a commerce name (design.md Decision 1 "Consequence").
export class ConnectAccountDto extends ValidateCredentialsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;
}
