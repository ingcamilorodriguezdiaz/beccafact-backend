import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateQuoteFollowUpDto {
  @IsIn(['CALL', 'EMAIL', 'MEETING', 'WHATSAPP', 'NOTE'], {
    message: 'Tipo de seguimiento inválido',
  })
  activityType: 'CALL' | 'EMAIL' | 'MEETING' | 'WHATSAPP' | 'NOTE';

  @IsString()
  @MaxLength(1000)
  notes: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
