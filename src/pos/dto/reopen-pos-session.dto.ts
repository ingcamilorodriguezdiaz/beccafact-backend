import { IsNumber, IsOptional, IsString, Min, IsUUID } from 'class-validator';

export class ReopenPosSessionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  initialCash?: number;

  @IsOptional()
  @IsUUID()
  terminalId?: string;

  @IsOptional()
  @IsUUID()
  shiftTemplateId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  governanceOverrideId?: string;
}
