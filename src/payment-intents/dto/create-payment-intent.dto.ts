import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentIntentDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  conversationId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsUUID()
  quoteId?: string;

  @ApiProperty()
  @IsNumber()
  amount: number;
}
