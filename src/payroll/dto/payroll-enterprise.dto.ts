import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const PAYROLL_PROCESS_AREAS = ['HR', 'PAYROLL', 'ACCOUNTING', 'SHARED'] as const;

export class CreatePayrollEnterpriseRuleDto {
  @IsIn(PAYROLL_PROCESS_AREAS)
  processArea!: (typeof PAYROLL_PROCESS_AREAS)[number];

  @IsString()
  @MaxLength(80)
  actionType!: string;

  @IsString()
  @MaxLength(120)
  policyName!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  allowedRoles?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requireDifferentActors?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requireBranchScope?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requireAccountingReview?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  sharedWithAreas?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  notes?: string;
}

export class UpdatePayrollEnterpriseRuleDto extends CreatePayrollEnterpriseRuleDto {}
