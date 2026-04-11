import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ExtendPayrollContractDto {
  @IsDateString()
  newEndDate: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ChangePayrollEmploymentDto {
  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsString()
  contractType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  payrollPolicyId?: string;

  @IsOptional()
  @IsString()
  payrollTypeConfigId?: string;

  @IsOptional()
  @IsDateString()
  contractEndDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateFinalSettlementDto {
  @IsDateString()
  payDate: string;

  @IsString()
  @IsNotEmpty()
  period: string;

  @IsOptional()
  @IsDateString()
  terminationDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  daysWorked?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vacationPay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonuses?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commissions?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherDeductions?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
