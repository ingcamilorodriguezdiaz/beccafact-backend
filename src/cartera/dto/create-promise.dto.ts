import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePaymentPromiseDto {
  @IsUUID('4', { message: 'El cliente es inválido' })
  customerId: string;

  @IsOptional()
  @IsUUID('4', { message: 'La factura es inválida' })
  invoiceId?: string;

  @IsNumber()
  @Min(0.01, { message: 'El monto prometido debe ser mayor a cero' })
  amount: number;

  @IsDateString({}, { message: 'La fecha prometida es inválida' })
  promisedDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
