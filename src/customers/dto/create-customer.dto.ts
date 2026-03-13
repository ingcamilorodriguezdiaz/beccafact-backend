import { IsString, IsEmail, IsOptional, IsEnum, IsNumber, Min, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';

export class CreateCustomerDto {
  @ApiProperty({ enum: ['NIT', 'CC', 'CE', 'PASSPORT', 'TI'] })@IsEnum(['NIT', 'CC', 'CE', 'PASSPORT', 'TI'])documentType: DocumentType;
  @ApiProperty({ example: '900123456' }) @IsString() @IsNotEmpty() documentNumber: string;
  @ApiProperty({ example: 'Cliente SAS' }) @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional({ example: '11001', description: 'Código DIVIPOLA del municipio (tabla 13.4.3 DIAN)' })
  @IsOptional() @IsString() cityCode?: string;
  @ApiPropertyOptional({ example: '11', description: 'Código DIVIPOLA del departamento (tabla 13.4.2 DIAN)' })
  @IsOptional() @IsString() departmentCode?: string;
  @ApiPropertyOptional({ example: 'CO', default: 'CO' }) @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional({
    example: 'ZZ',
    description: 'Responsabilidad fiscal DIAN (TipoResponsabilidad-2.1): O-13=Gran contribuyente, O-15=Autorretenedor, O-23=Agente ret.IVA, O-47=Simple tributación, ZZ=No aplica',
    default: 'ZZ',
  })
  @IsOptional() @IsString() taxLevelCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) creditDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}