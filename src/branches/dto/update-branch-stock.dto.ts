import { IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateBranchStockDto {
  @ApiProperty({ example: 'uuid-product-id' })
  @IsString()
  productId: string;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  stock: number;

  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  minStock: number;
}
