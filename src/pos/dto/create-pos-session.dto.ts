import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePosSessionDto {
  @IsNumber()
  @Min(0)
  initialCash: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
