import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignUserBranchDto {
  @ApiProperty({ example: 'uuid-user-id' })
  @IsString()
  userId: string;
}
