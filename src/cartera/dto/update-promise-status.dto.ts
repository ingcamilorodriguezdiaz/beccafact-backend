import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePaymentPromiseStatusDto {
  @IsIn(['OPEN', 'FULFILLED', 'BROKEN', 'CANCELLED'], {
    message: 'Estado de promesa inválido',
  })
  status: 'OPEN' | 'FULFILLED' | 'BROKEN' | 'CANCELLED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
