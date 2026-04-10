import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class InvoiceRegisterPaymentDto {
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a cero' })
  amount: number;

  @IsDateString({}, { message: 'Fecha de pago inválida' })
  paymentDate: string;

  @IsIn(['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'CONSIGNACION'], {
    message: 'Medio de pago inválido',
  })
  paymentMethod: 'EFECTIVO' | 'TRANSFERENCIA' | 'CHEQUE' | 'TARJETA' | 'CONSIGNACION';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
