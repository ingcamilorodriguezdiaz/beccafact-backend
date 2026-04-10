import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceType } from '@prisma/client';
import { IsBoolean, IsEnum, IsJSON, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateInvoiceDocumentConfigDto {
  @ApiPropertyOptional()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  posTerminalId?: string;

  @ApiPropertyOptional({ default: 'DIRECT' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ enum: InvoiceType, default: InvoiceType.VENTA })
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @ApiPropertyOptional()
  @IsString()
  prefix: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolutionNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolutionLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  rangeFrom?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  rangeTo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  technicalKey?: string;

  @ApiPropertyOptional({ description: 'JSON string con reglas fiscales adicionales' })
  @IsOptional()
  @IsJSON()
  fiscalRules?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateInvoiceDocumentConfigDto extends CreateInvoiceDocumentConfigDto {}
