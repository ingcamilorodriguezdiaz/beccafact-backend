import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateInvoicePaymentAgreementDto {
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
