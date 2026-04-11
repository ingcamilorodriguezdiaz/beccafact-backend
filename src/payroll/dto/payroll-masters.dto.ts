import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PayrollAppliedConceptDto {
  @IsOptional()
  @IsUUID()
  conceptId?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  rate?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class CreatePayrollConceptDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  nature: 'EARNING' | 'DEDUCTION';

  @IsOptional()
  @IsString()
  formulaType?: 'MANUAL' | 'FIXED_AMOUNT' | 'BASE_SALARY_PERCENT' | 'PROPORTIONAL_SALARY_PERCENT' | 'OVERTIME_FACTOR';

  @IsOptional()
  @IsString()
  formulaExpression?: string;

  @IsOptional()
  @IsNumber()
  defaultAmount?: number;

  @IsOptional()
  @IsNumber()
  defaultRate?: number;

  @IsOptional()
  @IsNumber()
  quantityDefault?: number;

  @IsOptional()
  @IsUUID()
  accountingAccountId?: string;

  @IsOptional()
  @IsString()
  costCenter?: string;

  @IsOptional()
  @IsString()
  projectCode?: string;

  @IsOptional()
  @IsBoolean()
  affectsSocialSecurity?: boolean;

  @IsOptional()
  @IsBoolean()
  affectsParafiscals?: boolean;

  @IsOptional()
  @IsBoolean()
  appliesByDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayrollConceptDto extends PartialType(CreatePayrollConceptDto) {}

export class CreatePayrollCalendarDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  frequency?: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'SPECIAL';

  @IsOptional()
  @IsInt()
  cutoffDay?: number;

  @IsOptional()
  @IsInt()
  paymentDay?: number;

  @IsOptional()
  @IsInt()
  startDay?: number;

  @IsOptional()
  @IsInt()
  endDay?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayrollCalendarDto extends PartialType(CreatePayrollCalendarDto) {}

export class CreatePayrollPolicyDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  applyAutoTransport?: boolean;

  @IsOptional()
  @IsNumber()
  transportAllowanceAmount?: number;

  @IsOptional()
  @IsNumber()
  transportCapMultiplier?: number;

  @IsOptional()
  @IsNumber()
  minimumWageValue?: number;

  @IsOptional()
  @IsNumber()
  healthEmployeeRate?: number;

  @IsOptional()
  @IsNumber()
  pensionEmployeeRate?: number;

  @IsOptional()
  @IsNumber()
  healthEmployerRate?: number;

  @IsOptional()
  @IsNumber()
  pensionEmployerRate?: number;

  @IsOptional()
  @IsNumber()
  arlRate?: number;

  @IsOptional()
  @IsNumber()
  compensationFundRate?: number;

  @IsOptional()
  @IsNumber()
  senaRate?: number;

  @IsOptional()
  @IsNumber()
  icbfRate?: number;

  @IsOptional()
  @IsNumber()
  healthCapSmmlv?: number;

  @IsOptional()
  @IsNumber()
  pensionCapSmmlv?: number;

  @IsOptional()
  @IsNumber()
  parafiscalCapSmmlv?: number;

  @IsOptional()
  @IsBoolean()
  applySena?: boolean;

  @IsOptional()
  @IsBoolean()
  applyIcbf?: boolean;

  @IsOptional()
  @IsNumber()
  overtimeFactor?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayrollPolicyDto extends PartialType(CreatePayrollPolicyDto) {}

export class CreatePayrollTypeConfigDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  calendarId?: string;

  @IsOptional()
  @IsUUID()
  policyId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayrollTypeConfigDto extends PartialType(CreatePayrollTypeConfigDto) {}

export class PayrollConceptSelectionListDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollAppliedConceptDto)
  items: PayrollAppliedConceptDto[];
}
