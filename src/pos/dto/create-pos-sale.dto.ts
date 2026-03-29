import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PaymentMethodDto {
  CASH = 'CASH',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
  MIXED = 'MIXED',
}

export class PosSaleItemDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsNumber()
  @Min(0)
  taxRate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export class CreatePosSaleDto {
  @IsUUID()
  sessionId: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items: PosSaleItemDto[];

  @IsEnum(PaymentMethodDto)
  paymentMethod: PaymentMethodDto;

  @IsNumber()
  @Min(0)
  amountPaid: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Si true y hay customerId, genera factura electrónica DRAFT automáticamente */
  @IsOptional()
  @IsBoolean()
  generateInvoice?: boolean;

  /** Si true, registra un anticipo (pago parcial). No genera factura hasta entregar y pagar el resto. */
  @IsOptional()
  @IsBoolean()
  isAdvancePayment?: boolean;

  /** Descuento global sobre el total (0-100%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cartDiscountPct?: number;
}
