import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectCarteraAdjustmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
