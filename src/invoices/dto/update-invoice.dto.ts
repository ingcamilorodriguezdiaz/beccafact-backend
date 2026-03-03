import {
  IsString, IsOptional, IsArray, ValidateNested,
  IsNumber, Min, IsDateString, IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateInvoiceItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()    productId?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  description?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.0001) quantity?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)      unitPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)      taxRate?:   number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)      discount?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)      position?:  number;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()       customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()     prefix?:     string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() issueDate?:  string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()     notes?:      string;
  @ApiPropertyOptional() @IsOptional() @IsString()     currency?:   string;

  @ApiPropertyOptional({ type: [UpdateInvoiceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceItemDto)
  items?: UpdateInvoiceItemDto[];
}
