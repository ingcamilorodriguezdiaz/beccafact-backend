import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateAccountingBankAccountDto {
  @ApiPropertyOptional({ description: 'Código del banco del catálogo maestro' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;

  @ApiProperty({ description: 'Cuenta contable asociada al banco' })
  @IsUUID()
  accountingAccountId: string;

  @ApiProperty({ description: 'Nombre interno de la cuenta bancaria' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: 'Número de cuenta bancaria' })
  @IsString()
  @MaxLength(60)
  accountNumber: string;

  @ApiPropertyOptional({ description: 'Moneda de la cuenta bancaria', default: 'COP' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ description: 'Saldo inicial de la cuenta bancaria', default: 0 })
  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @ApiPropertyOptional({ description: 'Indicador de activación', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
