import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReconcileBankMovementDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  receiptId?: string;
}
