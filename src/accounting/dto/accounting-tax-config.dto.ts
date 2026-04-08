import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpsertAccountingTaxConfigDto {
  @ApiProperty({ description: 'Código funcional del impuesto', example: 'IVA_GENERATED' })
  @IsString()
  @MaxLength(50)
  taxCode: string;

  @ApiProperty({ description: 'Etiqueta visible del impuesto', example: 'IVA generado' })
  @IsString()
  @MaxLength(120)
  label: string;

  @ApiPropertyOptional({ description: 'Tarifa de referencia', example: 19 })
  @IsOptional()
  @IsNumber()
  rate?: number;

  @ApiProperty({ description: 'Cuenta contable asociada a este concepto fiscal' })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({ description: 'Indicador de activación', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
