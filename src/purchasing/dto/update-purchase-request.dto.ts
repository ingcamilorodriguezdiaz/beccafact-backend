import { PartialType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CreatePurchaseRequestDto } from './create-purchase-request.dto';

export class UpdatePurchaseRequestDto extends PartialType(CreatePurchaseRequestDto) {}

const PURCHASE_REQUEST_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED'] as const;
export type PurchaseRequestStatusValue = typeof PURCHASE_REQUEST_STATUSES[number];

export class UpdatePurchaseRequestStatusDto {
  @IsIn(PURCHASE_REQUEST_STATUSES)
  status: PurchaseRequestStatusValue;
}
