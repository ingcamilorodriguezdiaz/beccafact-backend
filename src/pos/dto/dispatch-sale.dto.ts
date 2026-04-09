import { IsOptional, IsString } from 'class-validator';

export class DispatchSaleDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
