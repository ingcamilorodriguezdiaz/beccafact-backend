import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class QueueInvoiceReprocessDto {
  @ApiProperty({ enum: ['SEND_DIAN', 'QUERY_DIAN_STATUS'] })
  @IsString()
  @IsIn(['SEND_DIAN', 'QUERY_DIAN_STATUS'])
  actionType!: 'SEND_DIAN' | 'QUERY_DIAN_STATUS';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkInvoiceReprocessDto {
  @ApiProperty({ enum: ['SEND_DIAN', 'QUERY_DIAN_STATUS'] })
  @IsString()
  @IsIn(['SEND_DIAN', 'QUERY_DIAN_STATUS'])
  actionType!: 'SEND_DIAN' | 'QUERY_DIAN_STATUS';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  invoiceIds?: string[];
}

export class CreateInvoiceExternalIntakeDto {
  @ApiProperty({ example: 'ECOMMERCE' })
  @IsString()
  channel!: string;

  @ApiProperty({ example: 'WEB-1001' })
  @IsString()
  externalRef!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  customerPayload?: Record<string, any>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  invoicePayload?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoProcess?: boolean;
}
