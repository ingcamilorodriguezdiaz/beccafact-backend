import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpdatePosTerminalDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cashRegisterName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  printerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  printerConnectionType?: string;

  @IsOptional()
  @IsInt()
  @Min(58)
  printerPaperWidth?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  invoicePrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  receiptPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  resolutionNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  resolutionLabel?: string;

  @IsOptional()
  @IsUUID()
  defaultPriceListId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPrintReceipt?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPrintInvoice?: boolean;

  @IsOptional()
  @IsBoolean()
  requireCustomerForInvoice?: boolean;

  @IsOptional()
  @IsBoolean()
  allowOpenDrawer?: boolean;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
