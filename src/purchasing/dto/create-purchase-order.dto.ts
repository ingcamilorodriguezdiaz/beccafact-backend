import {
  IsString, IsOptional, IsUUID, IsDateString, IsNumber,
  Min, Max, IsArray, ValidateNested, ArrayMinSize, IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePurchaseOrderItemDto {
  @ApiPropertyOptional({ description: 'UUID del producto del catálogo (opcional si es ítem libre)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ example: 'Resma de papel carta x500' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 10, description: 'Cantidad (acepta decimales para unidades fraccionarias)' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiProperty({ example: 12500, description: 'Precio unitario sin impuestos' })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ example: 19, default: 19, description: 'Tasa de IVA en porcentaje (0–100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'Descuento en porcentaje (0–100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiProperty({ example: 1, description: 'Posición del ítem dentro de la orden (orden de aparición)' })
  @IsNumber()
  position: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'UUID del cliente asociado a la orden de compra' })
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({ description: 'UUID del proveedor (compatibilidad temporal con clientes antiguos)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'UUID del presupuesto de compras asociado' })
  @IsOptional()
  @IsUUID()
  budgetId?: string;

  @ApiProperty({ example: '2026-04-05', description: 'Fecha de emisión de la orden (ISO 8601)' })
  @IsDateString()
  issueDate: string;

  @ApiPropertyOptional({ example: '2026-05-05', description: 'Fecha límite de entrega/pago (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Notas u observaciones internas de la orden' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Área solicitante o responsable presupuestal' })
  @IsOptional()
  @IsString()
  requestingArea?: string;

  @ApiPropertyOptional({ description: 'Centro de costo asociado a la compra' })
  @IsOptional()
  @IsString()
  costCenter?: string;

  @ApiPropertyOptional({ description: 'Código de proyecto asociado a la compra' })
  @IsOptional()
  @IsString()
  projectCode?: string;

  @ApiPropertyOptional({ example: 'COP', default: 'COP', description: 'Código de moneda ISO 4217' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ type: [CreatePurchaseOrderItemDto], description: 'Ítems de la orden (mínimo 1)' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items: CreatePurchaseOrderItemDto[];
}
