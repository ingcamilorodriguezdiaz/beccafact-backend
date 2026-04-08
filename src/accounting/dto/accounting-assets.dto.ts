import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateAccountingFixedAssetDto {
  @ApiProperty() @IsString() @MaxLength(60) assetCode: string;
  @ApiProperty() @IsString() @MaxLength(180) name: string;
  @ApiProperty() @IsDateString() acquisitionDate: string;
  @ApiProperty() @IsDateString() startDepreciationDate: string;
  @ApiProperty() @IsNumber() @Min(0) cost: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) salvageValue?: number;
  @ApiProperty() @IsInt() @Min(1) usefulLifeMonths: number;
  @ApiProperty() @IsUUID() assetAccountId: string;
  @ApiProperty() @IsUUID() accumulatedDepAccountId: string;
  @ApiProperty() @IsUUID() depreciationExpenseAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class DepreciateAccountingFixedAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() runDate?: string;
}

export class CreateAccountingDeferredChargeDto {
  @ApiProperty() @IsString() @MaxLength(60) chargeCode: string;
  @ApiProperty() @IsString() @MaxLength(180) name: string;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiProperty() @IsInt() @Min(1) termMonths: number;
  @ApiProperty() @IsUUID() assetAccountId: string;
  @ApiProperty() @IsUUID() amortizationExpenseAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class AmortizeAccountingDeferredChargeDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() runDate?: string;
}

export class CreateAccountingProvisionTemplateDto {
  @ApiProperty() @IsString() @MaxLength(60) provisionCode: string;
  @ApiProperty() @IsString() @MaxLength(180) name: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) frequencyMonths?: number;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextRunDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiProperty() @IsUUID() expenseAccountId: string;
  @ApiProperty() @IsUUID() liabilityAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RunAccountingProvisionDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() runDate?: string;
}
