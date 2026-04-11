import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpsertPayrollAccountingProfileDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  @MaxLength(120)
  profileName: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  payrollTypeConfigId?: string;

  @IsUUID('4')
  expenseAccountId: string;

  @IsUUID('4')
  netPayableAccountId: string;

  @IsUUID('4')
  employeeDeductionsAccountId: string;

  @IsUUID('4')
  employerExpenseAccountId: string;

  @IsUUID('4')
  employerContributionsAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  costCenter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  projectCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
