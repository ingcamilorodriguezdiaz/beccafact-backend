import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpsertInvoiceAccountingProfileDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  @MaxLength(120)
  profileName: string;

  @IsString()
  @MaxLength(40)
  invoiceType: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sourceChannel?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsUUID('4')
  receivableAccountId: string;

  @IsUUID('4')
  revenueAccountId: string;

  @IsUUID('4')
  taxAccountId: string;

  @IsOptional()
  @IsUUID('4')
  withholdingReceivableAccountId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withholdingRate?: number;

  @IsOptional()
  @IsUUID('4')
  icaReceivableAccountId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  icaRate?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
