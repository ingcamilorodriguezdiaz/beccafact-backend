import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpdatePosShiftTemplateDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  startTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  toleranceMinutes?: number;

  @IsOptional()
  @IsBoolean()
  requiresBlindClose?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
