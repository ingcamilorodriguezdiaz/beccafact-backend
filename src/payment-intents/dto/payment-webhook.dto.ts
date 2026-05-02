import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentIntentStatus } from '@prisma/client';

export class PaymentWebhookDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  paymentIntentId: string;

  @ApiProperty({ enum: PaymentIntentStatus })
  @IsEnum(PaymentIntentStatus)
  status: PaymentIntentStatus;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  secret: string;
}
