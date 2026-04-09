import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PosPostSaleReturnItemDto {
  @IsUUID()
  saleItemId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;
}

class PosPostSaleReplacementItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;
}

export class CreatePosPostSaleRequestDto {
  @IsEnum(['RETURN', 'EXCHANGE'] as const)
  type!: 'RETURN' | 'EXCHANGE';

  @IsEnum([
    'DEFECTIVE_PRODUCT',
    'WRONG_PRODUCT',
    'CUSTOMER_DISSATISFACTION',
    'BILLING_ERROR',
    'WARRANTY',
    'OTHER',
  ] as const)
  reasonCode!:
    | 'DEFECTIVE_PRODUCT'
    | 'WRONG_PRODUCT'
    | 'CUSTOMER_DISSATISFACTION'
    | 'BILLING_ERROR'
    | 'WARRANTY'
    | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetail?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosPostSaleReturnItemDto)
  items!: PosPostSaleReturnItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosPostSaleReplacementItemDto)
  replacements?: PosPostSaleReplacementItemDto[];
}

export class ResolvePosPostSaleRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  approvalNotes?: string;
}
