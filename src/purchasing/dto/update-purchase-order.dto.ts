import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePurchaseOrderDto } from './create-purchase-order.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';

// Para actualización completa de una orden en estado DRAFT
// Se omiten customerId/supplierId para evitar cambios que romperían la integridad referencial
export class UpdatePurchaseOrderDto extends PartialType(
  OmitType(CreatePurchaseOrderDto, ['customerId', 'supplierId'] as const),
) {}

// DTO exclusivo para el endpoint PATCH /:id/status
export class UpdatePurchaseOrderStatusDto {
  @ApiPropertyOptional({ enum: PurchaseOrderStatus, description: 'Nuevo estado de la orden de compra' })
  @IsEnum(PurchaseOrderStatus)
  status: PurchaseOrderStatus;
}
