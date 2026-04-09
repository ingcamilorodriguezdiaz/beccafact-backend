import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export enum PosPromotionTypeDto {
  PRODUCT = 'PRODUCT',
  CUSTOMER = 'CUSTOMER',
  ORDER = 'ORDER',
  VOLUME = 'VOLUME',
  SCHEDULE = 'SCHEDULE',
}

export enum PosDiscountModeDto {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export class PosPriceListItemDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  minQuantity?: number;
}

export class CreatePosPriceListDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosPriceListItemDto)
  items: PosPriceListItemDto[];
}

export class UpdatePosPriceListDto extends CreatePosPriceListDto {}

export class PosComboItemDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;
}

export class CreatePosComboDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  comboPrice: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosComboItemDto)
  items: PosComboItemDto[];
}

export class UpdatePosComboDto extends CreatePosComboDto {}

export class CreatePosPromotionDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PosPromotionTypeDto)
  type: PosPromotionTypeDto;

  @IsEnum(PosDiscountModeDto)
  discountMode: PosDiscountModeDto;

  @IsNumber()
  @Min(0)
  discountValue: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  minQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minSubtotal?: number;

  @IsOptional()
  @IsArray()
  daysOfWeek?: number[];

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePosPromotionDto extends CreatePosPromotionDto {}

export class PreviewPosPricingItemDto {
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

export class PreviewPosPricingDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  priceListId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cartDiscountPct?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewPosPricingItemDto)
  items: PreviewPosPricingItemDto[];
}
