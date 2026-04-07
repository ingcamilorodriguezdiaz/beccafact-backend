import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportBankStatementDto {
  @IsString()
  csvText: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  delimiter?: string;

  @IsOptional()
  @IsBoolean()
  autoMatchReceipts?: boolean;
}
