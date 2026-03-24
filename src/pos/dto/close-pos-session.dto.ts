import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ClosePosSessionDto {
  @IsNumber()
  @Min(0)
  finalCash: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
