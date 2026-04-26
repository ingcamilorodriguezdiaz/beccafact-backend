import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AdminUpdatePasswordDto {
  @ApiProperty({ example: 'Secure123!' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
