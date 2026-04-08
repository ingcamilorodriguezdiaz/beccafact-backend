import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export enum PurchaseAdjustmentTypeValue {
  RETURN = 'RETURN',
  CREDIT_NOTE = 'CREDIT_NOTE',
  DEBIT_NOTE = 'DEBIT_NOTE',
  RECEIPT_REVERSAL = 'RECEIPT_REVERSAL',
  INVOICE_REVERSAL = 'INVOICE_REVERSAL',
  PAYMENT_REVERSAL = 'PAYMENT_REVERSAL',
}

export class CreatePurchaseAdjustmentDto {
  @IsUUID()
  customerId: string;

  @IsEnum(PurchaseAdjustmentTypeValue)
  type: PurchaseAdjustmentTypeValue;

  @IsOptional()
  @IsUUID()
  receiptId?: string;

  @IsOptional()
  @IsUUID()
  purchaseInvoiceId?: string;

  @IsOptional()
  @IsUUID()
  accountPayableId?: string;

  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DecidePurchaseAdjustmentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
