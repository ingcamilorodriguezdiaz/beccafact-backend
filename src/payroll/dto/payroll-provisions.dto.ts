import { IsOptional, IsString } from 'class-validator';

export class RunPayrollProvisionDto {
  @IsString()
  period: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
