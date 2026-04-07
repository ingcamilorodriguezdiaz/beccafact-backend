import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportReceiptsBatchDto {
  @IsString()
  csvText: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  delimiter?: string;

  @IsOptional()
  @IsBoolean()
  applyByInvoiceNumber?: boolean;
}
