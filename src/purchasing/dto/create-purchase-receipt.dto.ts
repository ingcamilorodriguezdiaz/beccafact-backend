import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseReceiptItemDto {
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderedQuantity?: number;

  @IsNumber()
  @Min(0.0001)
  receivedQuantity: number;

  @IsNumber()
  @Min(1)
  position: number;
}

export class CreatePurchaseReceiptDto {
  @IsUUID()
  orderId: string;

  @IsDateString()
  receiptDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReceiptItemDto)
  items: CreatePurchaseReceiptItemDto[];
}
