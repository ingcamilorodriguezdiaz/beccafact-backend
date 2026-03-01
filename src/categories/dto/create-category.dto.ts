// create-category.dto.ts
import { IsString, IsOptional, IsUUID, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Electrónica' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Productos electrónicos y tecnología' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'UUID categoría padre (para jerarquía)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
