import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum PosGovernanceActionDto {
  MANUAL_DISCOUNT = 'MANUAL_DISCOUNT',
  CASH_WITHDRAWAL = 'CASH_WITHDRAWAL',
  CANCEL_SALE = 'CANCEL_SALE',
  REFUND_SALE = 'REFUND_SALE',
  REOPEN_SESSION = 'REOPEN_SESSION',
  APPROVE_POST_SALE = 'APPROVE_POST_SALE',
}

export class SavePosGovernanceRuleDto {
  @IsEnum(PosGovernanceActionDto)
  action: PosGovernanceActionDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedRoles?: string[];

  @IsOptional()
  @IsBoolean()
  requiresSupervisorOverride?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDiscountPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmountThreshold?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreatePosSupervisorOverrideDto {
  @IsEnum(PosGovernanceActionDto)
  action: PosGovernanceActionDto;

  @IsString()
  @MaxLength(80)
  resourceType: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  resourceId?: string;

  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsObject()
  requestedPayload?: Record<string, unknown>;
}

export class ResolvePosSupervisorOverrideDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
