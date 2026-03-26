import { IsEnum, IsNumber, IsString, Min, MaxLength } from 'class-validator';
import { CashMovementType } from '@prisma/client';

export class CreateCashMovementDto {
  @IsEnum(CashMovementType)
  type: CashMovementType; // IN | OUT

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @MaxLength(200)
  reason: string;
}
