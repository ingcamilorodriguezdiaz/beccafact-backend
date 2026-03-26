import {
  IsNumber,
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  Min,
  MaxLength,
} from 'class-validator';

export enum PaymentMethod {
  EFECTIVO     = 'EFECTIVO',
  TRANSFERENCIA = 'TRANSFERENCIA',
  CHEQUE       = 'CHEQUE',
  TARJETA      = 'TARJETA',
  CONSIGNACION = 'CONSIGNACION',
}

export class RegisterPaymentDto {
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a cero' })
  amount: number;

  @IsDateString({}, { message: 'Fecha de pago inválida' })
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
}
