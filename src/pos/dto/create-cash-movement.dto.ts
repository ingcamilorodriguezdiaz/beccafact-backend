import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
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

  @IsOptional()
  @IsUUID()
  governanceOverrideId?: string;
}
