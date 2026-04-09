import { IsNumber, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class ClosePosSessionDto {
  @IsNumber()
  @Min(0)
  finalCash: number;

  @IsOptional()
  @IsObject()
  denominations?: Record<string, number>;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  governanceOverrideId?: string;
}
