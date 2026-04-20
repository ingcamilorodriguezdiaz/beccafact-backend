import {
  IsString, IsOptional, IsEnum, IsUUID, IsArray, ValidateNested,
  IsNumber, Min, IsDateString, IsBoolean, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceType } from '@prisma/client';

export class InvoiceItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiProperty() @IsString() description: string;
  @ApiProperty() @IsNumber() @Min(0.0001) quantity: number;
  @ApiProperty() @IsNumber() @Min(0) unitPrice: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) position?: number;
  @ApiPropertyOptional({ default: 19 }) @IsOptional() @IsNumber() @Min(0) taxRate?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) discount?: number;
}

export class CreateInvoiceDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional({ enum: ['VENTA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'SOPORTE_ADQUISICION'] })
  @ApiPropertyOptional({ enum: InvoiceType })
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;
  @ApiPropertyOptional({ default: 'FV' }) @IsOptional() @IsString() prefix?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() issueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiProperty({ type: [InvoiceItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items: InvoiceItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ default: 'COP' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isDraft?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() sendToDian?: boolean;
  @ApiPropertyOptional({ description: 'Configuración documental a aplicar' })
  @IsOptional()
  @IsUUID()
  documentConfigId?: string;
  @ApiPropertyOptional({ description: 'Canal origen: DIRECT, POS, ECOMMERCE, MARKETPLACE, etc.' })
  @IsOptional()
  @IsString()
  sourceChannel?: string;
  @ApiPropertyOptional({ description: 'Terminal POS origen, si aplica' })
  @IsOptional()
  @IsUUID()
  sourceTerminalId?: string;
  @ApiPropertyOptional({ description: 'Venta POS origen, si aplica' })
  @IsOptional()
  @IsUUID()
  posSaleId?: string;

  @ApiPropertyOptional({ description: 'Snapshot fiscal interno para documentos especializados como POS electrónico' })
  @IsOptional()
  @IsObject()
  fiscalRulesSnapshot?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Uso interno para controlar el momento del impacto operativo de inventario' })
  @IsOptional()
  @IsString()
  inventoryMode?: string;

  @ApiPropertyOptional({ description: 'ID de la factura original (obligatorio para NOTA_CREDITO y NOTA_DEBITO)' })
  @IsOptional()
  @IsUUID()
  originalInvoiceId?: string;

  @ApiPropertyOptional({
    description: 'Código motivo DIAN: 1=Devolución parcial bienes, 2=Anulación factura, 3=Rebaja precio, 4=Ajuste calidad, 5=Rescisión, 6=Otros',
    enum: ['1','2','3','4','5','6'],
  })
  @IsOptional()
  @IsString()
  discrepancyReasonCode?: string;

  @ApiPropertyOptional({ description: 'Descripción del motivo del ajuste' })
  @IsOptional()
  @IsString()
  discrepancyReason?: string;
}
