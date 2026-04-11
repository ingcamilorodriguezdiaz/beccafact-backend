import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class CreatePayrollEmployeeRequestDto {
  @IsString()
  @IsIn(['VACATION', 'LICENSE'])
  requestType: 'VACATION' | 'LICENSE';

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'El período debe tener formato YYYY-MM' })
  period?: string;

  @IsString()
  startDate: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  days?: number;

  @IsOptional()
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
