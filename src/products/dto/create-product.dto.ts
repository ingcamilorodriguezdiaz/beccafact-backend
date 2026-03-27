import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TaxType, ProductStatus } from '@prisma/client';

export class CreateProductDto {

  @ApiProperty({ example: 'Laptop Asus i5' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'LAP-ASUS-001' })
  @IsString()
  @MaxLength(100)
  sku: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 2500000 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 1800000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ example: 'UND' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 19 })
  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @ApiPropertyOptional({ enum: TaxType })
  @IsOptional()
  @IsEnum(TaxType)
  taxType?: TaxType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ description: 'ID de la sucursal a la que pertenece este producto' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

}