import { PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

const PURCHASE_BUDGET_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export type PurchaseBudgetStatusValue = typeof PURCHASE_BUDGET_STATUSES[number];

export class CreatePurchaseBudgetDto {
  @IsString()
  title: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(PURCHASE_BUDGET_STATUSES)
  status?: PurchaseBudgetStatusValue;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  costCenter?: string;

  @IsOptional()
  @IsString()
  projectCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePurchaseBudgetDto extends PartialType(CreatePurchaseBudgetDto) {}
