import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveClosePosSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}
