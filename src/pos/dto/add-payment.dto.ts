import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethodDto, PosSalePaymentLineDto } from './create-pos-sale.dto';

export class AddPaymentDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amountPaid?: number;

  @IsOptional()
  @IsEnum(PaymentMethodDto)
  paymentMethod?: PaymentMethodDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosSalePaymentLineDto)
  payments?: PosSalePaymentLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
