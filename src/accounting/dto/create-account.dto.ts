import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountNature } from '@prisma/client';

export class CreateAccountDto {
  @ApiProperty({ example: '1105', description: 'Código PUC de la cuenta (único por empresa)' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Caja General', description: 'Nombre descriptivo de la cuenta' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 2, description: 'Nivel jerárquico del PUC (1=clase, 2=grupo, 3=cuenta, 4=subcuenta)', minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  level: number;

  @ApiPropertyOptional({ example: 'uuid-parent', description: 'ID de la cuenta padre (null para cuentas de nivel 1)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiProperty({ enum: AccountNature, description: 'Naturaleza de la cuenta: DEBIT (débito) o CREDIT (crédito)' })
  @IsEnum(AccountNature)
  nature: AccountNature;
}
