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
  DATAPHONE = 'DATAPHONE',
  WALLET = 'WALLET',
  VOUCHER = 'VOUCHER',
  GIFT_CARD = 'GIFT_CARD',
  AGREEMENT = 'AGREEMENT',
}

export enum PosOrderTypeDto {
  IN_STORE = 'IN_STORE',
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
  LAYAWAY = 'LAYAWAY',
  PREORDER = 'PREORDER',
}

export enum PosDocumentModeDto {
  POS_ELECTRONIC = 'POS_ELECTRONIC',
  ELECTRONIC_INVOICE = 'ELECTRONIC_INVOICE',
  NONE = 'NONE',
}

export class PosSalePaymentLineDto {
  @IsEnum(PaymentMethodDto)
  paymentMethod: PaymentMethodDto;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  transactionReference?: string;

  @IsOptional()
  @IsString()
  providerName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
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
  @IsString()
  clientSyncId?: string;

  @IsOptional()
  @IsUUID()
  inventoryLocationId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  externalOrderId?: string;

  @IsOptional()
  @IsEnum(PosOrderTypeDto)
  orderType?: PosOrderTypeDto;

  @IsOptional()
  @IsString()
  orderReference?: string;

  @IsOptional()
  @IsString()
  sourceChannel?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  deliveryContactName?: string;

  @IsOptional()
  @IsString()
  deliveryContactPhone?: string;

  @IsOptional()
  @IsUUID()
  priceListId?: string;

  @IsOptional()
  @IsUUID()
  governanceOverrideId?: string;

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  loyaltyPointsToRedeem?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items: PosSaleItemDto[];

  @IsOptional()
  @IsEnum(PaymentMethodDto)
  paymentMethod?: PaymentMethodDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosSalePaymentLineDto)
  payments?: PosSalePaymentLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  /** Si true y hay customerId, genera factura electrónica DRAFT automáticamente */
  @IsOptional()
  @IsBoolean()
  generateInvoice?: boolean;

  /** Define si la venta debe emitirse como POS electrónico o factura electrónica. */
  @IsOptional()
  @IsEnum(PosDocumentModeDto)
  documentMode?: PosDocumentModeDto;

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
