import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PosDiscountMode, PosOrderType } from '@prisma/client';

export class CreatePosCouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PosDiscountMode)
  discountMode: PosDiscountMode;

  @IsNumber()
  @Min(0.01)
  discountValue: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minSubtotal?: number;

  @IsOptional()
  @IsString()
  targetSegment?: string;

  @IsOptional()
  @IsString()
  targetTier?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePosCouponDto extends CreatePosCouponDto {}

export class CreatePosExternalOrderItemDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class CreatePosExternalOrderDto {
  @IsString()
  @IsNotEmpty()
  channel: string;

  @IsString()
  @IsNotEmpty()
  externalOrderNumber: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsEnum(PosOrderType)
  orderType?: PosOrderType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePosExternalOrderItemDto)
  items?: CreatePosExternalOrderItemDto[];

  @IsOptional()
  payload?: Record<string, unknown>;
}

export class UpdatePosExternalOrderStatusDto {
  @IsString()
  @IsNotEmpty()
  status: string;

  @IsOptional()
  payload?: Record<string, unknown>;
}

export class CreatePosReplenishmentRequestDto {
  @IsOptional()
  @IsDateString()
  neededByDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  requestingArea?: string;

  @IsOptional()
  @IsString()
  costCenter?: string;

  @IsOptional()
  @IsString()
  projectCode?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productIds?: string[];
}

export class ReconcilePosElectronicPaymentsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
