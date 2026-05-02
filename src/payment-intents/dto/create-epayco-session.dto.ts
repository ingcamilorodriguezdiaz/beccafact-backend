import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID } from 'class-validator';

export class CreateEpaycoSessionDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  planId: string;

  @ApiProperty({ enum: ['MONTHLY', 'ANNUAL'] })
  @IsString()
  @IsIn(['MONTHLY', 'ANNUAL'])
  billingCycle: 'MONTHLY' | 'ANNUAL';
}
