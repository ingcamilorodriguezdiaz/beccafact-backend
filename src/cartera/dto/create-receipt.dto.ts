import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from './register-payment.dto';

export class ReceiptApplicationDto {
  @IsUUID('4', { message: 'La factura es inválida' })
  invoiceId: string;

  @IsNumber()
  @Min(0.01, { message: 'El monto aplicado debe ser mayor a cero' })
  amount: number;
}

export class CreateReceiptDto {
  @IsUUID('4', { message: 'El cliente es inválido' })
  customerId: string;

  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a cero' })
  amount: number;

  @IsDateString({}, { message: 'Fecha de recaudo inválida' })
  paymentDate: string;

  @IsEnum(PaymentMethod, { message: 'Medio de pago inválido' })
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiptApplicationDto)
  applications?: ReceiptApplicationDto[];
}
