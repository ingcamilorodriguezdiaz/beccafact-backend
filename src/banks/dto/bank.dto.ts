import { ApiProperty } from '@nestjs/swagger';

export class BankResponseDto {
  @ApiProperty({ description: 'UUID del banco' })
  id: string;

  @ApiProperty({ description: 'Código del banco (ej: 001, 007, 023)' })
  code: string;

  @ApiProperty({ description: 'Nombre del banco' })
  name: string;

  @ApiProperty({ description: 'Indica si el banco está activo' })
  isActive: boolean;
}
