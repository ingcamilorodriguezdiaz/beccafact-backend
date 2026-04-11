import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePayrollBatchDto {
  @IsString()
  period: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  employeeIds?: string[];
}

export class PayrollPeriodControlDto {
  @IsString()
  period: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
