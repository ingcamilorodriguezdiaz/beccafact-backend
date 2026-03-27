import { IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferStockDto {
  @ApiProperty({ example: 'uuid-to-branch-id' })
  @IsString()
  toBranchId: string;

  @ApiProperty({ example: 'uuid-product-id' })
  @IsString()
  productId: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(1)
  quantity: number;
}
