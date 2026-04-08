import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  Min,
  Max,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// DTO para cada ítem de la cotización
export class CreateQuoteItemDto {
  @ApiPropertyOptional({ description: 'UUID del producto (opcional)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ description: 'Descripción del ítem' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Cantidad del ítem', minimum: 0.0001 })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiProperty({ description: 'Precio unitario', minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ description: 'Tasa de impuesto (%)', default: 19, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({ description: 'Descuento por línea (%)', default: 0, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiProperty({ description: 'Posición del ítem en la cotización' })
  @IsNumber()
  position: number;
}

// DTO principal para crear una cotización
export class CreateQuoteDto {
  @ApiProperty({ description: 'UUID del cliente' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ description: 'Fecha de emisión (ISO 8601)', example: '2026-04-05' })
  @IsDateString()
  issueDate: string;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento (ISO 8601)', example: '2026-05-05' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Notas internas de la cotización' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Términos y condiciones de la cotización' })
  @IsOptional()
  @IsString()
  terms?: string;

  @ApiPropertyOptional({ description: 'Responsable comercial de la cotización' })
  @IsOptional()
  @IsString()
  salesOwnerName?: string;

  @ApiPropertyOptional({ description: 'Oportunidad comercial asociada' })
  @IsOptional()
  @IsString()
  opportunityName?: string;

  @ApiPropertyOptional({ description: 'Canal u origen de la oportunidad' })
  @IsOptional()
  @IsString()
  sourceChannel?: string;

  @ApiPropertyOptional({ description: 'Moneda de la cotización', default: 'COP', example: 'COP' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Etiqueta o nombre del término de pago' })
  @IsOptional()
  @IsString()
  paymentTermLabel?: string;

  @ApiPropertyOptional({ description: 'Días de crédito o plazo de pago' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  paymentTermDays?: number;

  @ApiPropertyOptional({ description: 'Tiempo de entrega prometido en días' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryLeadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Condiciones logísticas o de entrega' })
  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @ApiPropertyOptional({ description: 'Código incoterm, por ejemplo EXW, FOB o CIF' })
  @IsOptional()
  @IsString()
  incotermCode?: string;

  @ApiPropertyOptional({ description: 'Ubicación o punto asociado al incoterm' })
  @IsOptional()
  @IsString()
  incotermLocation?: string;

  @ApiPropertyOptional({ description: 'Tasa de cambio aplicada a la cotización', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  exchangeRate?: number;

  @ApiPropertyOptional({ description: 'Cláusulas o condiciones comerciales avanzadas' })
  @IsOptional()
  @IsString()
  commercialConditions?: string;

  @ApiPropertyOptional({ description: 'Descuento global sobre el total', default: 0, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiProperty({ description: 'Ítems de la cotización (mínimo 1)', type: [CreateQuoteItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  items: CreateQuoteItemDto[];
}
