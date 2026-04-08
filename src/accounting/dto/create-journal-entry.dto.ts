import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsNumber,
  IsInt,
  Min,
  IsDateString,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JournalSourceType } from '@prisma/client';

export class CreateJournalEntryLineDto {
  @ApiProperty({ example: 'uuid-account', description: 'ID de la cuenta contable' })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({ example: 'Pago de nómina enero', description: 'Descripción de la línea' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid-branch', description: 'Sucursal asociada a la línea contable' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: 'uuid-customer', description: 'Cliente/tercero asociado a la línea' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'ADM-001', description: 'Centro de costo libre de la línea' })
  @IsOptional()
  @IsString()
  costCenter?: string;

  @ApiPropertyOptional({ example: 'PRJ-VENTAS-2026', description: 'Código de proyecto o frente de trabajo' })
  @IsOptional()
  @IsString()
  projectCode?: string;

  @ApiProperty({ example: 1500000, description: 'Valor débito de la línea (0 si es crédito)' })
  @IsNumber()
  @Min(0)
  debit: number;

  @ApiProperty({ example: 0, description: 'Valor crédito de la línea (0 si es débito)' })
  @IsNumber()
  @Min(0)
  credit: number;

  @ApiProperty({ example: 1, description: 'Posición/orden de la línea dentro del comprobante' })
  @IsInt()
  @Min(1)
  position: number;
}

export class CreateJournalEntryDto {
  @ApiProperty({ example: '2026-04-05', description: 'Fecha del comprobante en formato ISO (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: 'Comprobante de apertura', description: 'Descripción general del comprobante' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ example: 'REF-2026-001', description: 'Referencia externa del comprobante' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ enum: JournalSourceType, description: 'Origen del comprobante (MANUAL si se omite)' })
  @IsOptional()
  @IsEnum(JournalSourceType)
  sourceType?: JournalSourceType;

  @ApiPropertyOptional({ example: 'uuid-source', description: 'ID del documento de origen (factura, compra, etc.)' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiProperty({
    type: [CreateJournalEntryLineDto],
    description: 'Líneas del comprobante. Debe cumplir partida doble: sum(debit) === sum(credit)',
    minItems: 2,
  })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];
}
