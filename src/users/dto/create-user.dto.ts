import {
  IsEmail, IsString, IsOptional, IsUUID, MinLength, MaxLength, IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'juan@empresa.com' }) @IsEmail() email: string;
  @ApiProperty({ example: 'Secure123!' }) @IsString() @MinLength(8) password: string;
  @ApiProperty({ example: 'Juan' }) @IsString() @IsNotEmpty() firstName: string;
  @ApiProperty({ example: 'Pérez' }) @IsString() @IsNotEmpty() lastName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ description: 'UUID del rol a asignar' }) @IsOptional() @IsUUID() roleId?: string;
}
