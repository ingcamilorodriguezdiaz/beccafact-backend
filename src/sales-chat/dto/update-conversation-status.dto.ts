import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SalesConversationStatus } from '@prisma/client';

export class UpdateConversationStatusDto {
  @ApiProperty({ enum: SalesConversationStatus })
  @IsEnum(SalesConversationStatus)
  status: SalesConversationStatus;
}
