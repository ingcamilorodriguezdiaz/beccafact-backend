import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseRequestItemDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedUnitPrice?: number;

  @IsNumber()
  @Min(1)
  position: number;
}

export class CreatePurchaseRequestDto {
  @IsDateString()
  requestDate: string;

  @IsOptional()
  @IsDateString()
  neededByDate?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  budgetId?: string;

  @IsOptional()
  @IsString()
  requestingArea?: string;

  @IsOptional()
  @IsString()
  costCenter?: string;

  @IsOptional()
  @IsString()
  projectCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseRequestItemDto)
  items: CreatePurchaseRequestItemDto[];
}

export class RequestPurchaseApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DecidePurchaseApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ConvertPurchaseRequestToOrderDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  budgetId?: string;
}
