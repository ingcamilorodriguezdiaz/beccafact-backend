import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateQuoteApprovalPolicyDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: ['TOTAL', 'DISCOUNT'] })
  @IsString()
  @IsIn(['TOTAL', 'DISCOUNT'])
  approvalType: 'TOTAL' | 'DISCOUNT';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  thresholdValue: number;

  @ApiProperty({ description: 'Rol requerido para aprobar, por ejemplo MANAGER o ADMIN' })
  @IsString()
  requiredRole: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  sequence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateQuoteApprovalPolicyDto extends PartialType(CreateQuoteApprovalPolicyDto) {}
