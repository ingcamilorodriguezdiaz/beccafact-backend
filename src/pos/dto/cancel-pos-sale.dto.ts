import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CancelPosSaleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsUUID()
  governanceOverrideId?: string;
}
