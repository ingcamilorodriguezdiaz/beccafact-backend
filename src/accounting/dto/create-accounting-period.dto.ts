import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateAccountingPeriodDto {
  @ApiProperty({ example: 2026, description: 'Año fiscal del período' })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 4, description: 'Mes del período contable (1-12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiPropertyOptional({ example: 'Abril 2026', description: 'Nombre descriptivo del período' })
  @IsOptional()
  @IsString()
  name?: string;
}
