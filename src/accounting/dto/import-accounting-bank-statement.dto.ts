import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ImportAccountingBankStatementDto {
  @ApiProperty({ description: 'Cuenta bancaria contable sobre la cual se importa el extracto' })
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'Contenido CSV del extracto bancario' })
  @IsString()
  csvText: string;

  @ApiPropertyOptional({ description: 'Separador del archivo', default: ',' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  delimiter?: string;

  @ApiPropertyOptional({ description: 'Intentar conciliación automática por referencia', default: true })
  @IsOptional()
  @IsBoolean()
  autoMatchEntries?: boolean;
}
