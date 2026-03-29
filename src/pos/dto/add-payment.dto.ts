import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMethodDto } from './create-pos-sale.dto';

export class AddPaymentDto {
  @IsNumber()
  @Min(0.01)
  amountPaid: number;

  @IsEnum(PaymentMethodDto)
  paymentMethod: PaymentMethodDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
