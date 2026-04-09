import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreatePosSessionDto {
  @IsNumber()
  @Min(0)
  initialCash: number;

  @IsOptional()
  @IsUUID()
  terminalId?: string;

  @IsOptional()
  @IsUUID()
  shiftTemplateId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
