import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class RequestInvoiceApprovalDto {
  @ApiProperty({ enum: ['ISSUE', 'CANCEL'] })
  @IsString()
  @MaxLength(20)
  actionType: 'ISSUE' | 'CANCEL';

  @ApiPropertyOptional({ description: 'Motivo de la solicitud de aprobación' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectInvoiceApprovalDto {
  @ApiPropertyOptional({ description: 'Motivo del rechazo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AddInvoiceAttachmentDto {
  @ApiProperty({ example: 'Soporte despacho.pdf' })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'https://cdn.beccafact.com/invoices/soporte-despacho.pdf' })
  @IsUrl()
  fileUrl: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @ApiPropertyOptional({ example: 'SOPORTE' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ example: 'Soporte operativo de entrega' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 24567 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}
