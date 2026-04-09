import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PosInventoryLocationTypeDto {
  STORE = 'STORE',
  BACKROOM = 'BACKROOM',
  WAREHOUSE = 'WAREHOUSE',
  TRANSIT = 'TRANSIT',
}

export class CreatePosInventoryLocationDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsString()
  @MaxLength(30)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(PosInventoryLocationTypeDto)
  type?: PosInventoryLocationTypeDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPosSales?: boolean;
}

export class UpdatePosInventoryLocationDto {
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(PosInventoryLocationTypeDto)
  type?: PosInventoryLocationTypeDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPosSales?: boolean;
}

export class UpsertPosInventoryStockDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lotNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class CreatePosInventoryTransferItemDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lotNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class CreatePosInventoryTransferDto {
  @IsUUID()
  fromLocationId!: string;

  @IsUUID()
  toLocationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePosInventoryTransferItemDto)
  items!: CreatePosInventoryTransferItemDto[];
}
