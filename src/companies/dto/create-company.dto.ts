import { IsString, IsEmail, IsOptional, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Empresa SAS' }) @IsString() @IsNotEmpty() name: string;
  @ApiProperty({ example: '900123456-7' }) @IsString() @Matches(/^\d{9,10}-\d$/, { message: 'NIT inválido (ej: 900123456-7)' }) nit: string;
  @ApiProperty({ example: 'EMPRESA EJEMPLO S.A.S.' }) @IsString() razonSocial: string;
  @ApiProperty({ example: 'contacto@empresa.com' }) @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiProperty({ example: 'plan-uuid' }) @IsString() planId: string;
}
