import { PartialType, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { QuoteStatus } from '@prisma/client';
import { CreateQuoteDto } from './create-quote.dto';

// UpdateQuoteDto hereda todos los campos de CreateQuoteDto como opcionales,
// excepto los ítems que se deben pasar explícitamente al actualizar
export class UpdateQuoteDto extends PartialType(CreateQuoteDto) {}

// DTO para cambio manual de estado (endpoint PATCH /:id/status)
export class UpdateQuoteStatusDto {
  @ApiPropertyOptional({
    enum: QuoteStatus,
    description: 'Nuevo estado de la cotización. No se permite CONVERTED manualmente.',
  })
  @IsEnum(QuoteStatus)
  status: QuoteStatus;

  @ApiPropertyOptional({
    description: 'Motivo comercial de rechazo o pérdida',
  })
  @IsOptional()
  @IsString()
  lostReason?: string;
}
