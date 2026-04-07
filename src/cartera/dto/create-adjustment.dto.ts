import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCarteraAdjustmentDto {
  @IsIn(['CREDIT_NOTE', 'DEBIT_NOTE', 'WRITE_OFF', 'PROVISION', 'RECOVERY', 'RECEIPT_REVERSAL'], {
    message: 'Tipo de ajuste inválido',
  })
  type:
    | 'CREDIT_NOTE'
    | 'DEBIT_NOTE'
    | 'WRITE_OFF'
    | 'PROVISION'
    | 'RECOVERY'
    | 'RECEIPT_REVERSAL';

  @IsUUID('4', { message: 'El cliente es inválido' })
  customerId: string;

  @IsOptional()
  @IsUUID('4', { message: 'La factura es inválida' })
  invoiceId?: string;

  @IsOptional()
  @IsString({ message: 'El recaudo es inválido' })
  @MaxLength(120)
  receiptId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El documento origen es inválido' })
  sourceInvoiceId?: string;

  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a cero' })
  amount: number;

  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
