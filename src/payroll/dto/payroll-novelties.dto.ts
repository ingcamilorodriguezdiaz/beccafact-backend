import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreatePayrollNoveltyDto {
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsString()
  type:
    | 'OVERTIME'
    | 'SURCHARGE'
    | 'SICK_LEAVE'
    | 'LICENSE'
    | 'VACATION'
    | 'LOAN'
    | 'GARNISHMENT'
    | 'ADMISSION'
    | 'TERMINATION'
    | 'SALARY_CHANGE'
    | 'OTHER_EARNING'
    | 'OTHER_DEDUCTION';

  @IsOptional()
  @IsString()
  period?: string;

  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  hours?: number;

  @IsOptional()
  @IsNumber()
  days?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  rate?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  salaryFrom?: number;

  @IsOptional()
  @IsNumber()
  salaryTo?: number;
}

export class UpdatePayrollNoveltyDto extends PartialType(CreatePayrollNoveltyDto) {
  @IsOptional()
  @IsString()
  status?: 'PENDING' | 'APPLIED' | 'CANCELLED';
}
