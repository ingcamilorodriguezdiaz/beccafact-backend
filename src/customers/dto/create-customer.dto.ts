import { IsString, IsEmail, IsOptional, IsEnum, IsNumber, Min, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';

export class CreateCustomerDto {
  @ApiProperty({ enum: ['NIT', 'CC', 'CE', 'PASSPORT', 'TI'] })@IsEnum(['NIT', 'CC', 'CE', 'PASSPORT', 'TI'])documentType: DocumentType;
  @ApiProperty({ example: '900123456-7' }) @IsString() @IsNotEmpty() documentNumber: string;
  @ApiProperty({ example: 'Cliente SAS' }) @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) creditDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
