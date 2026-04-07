import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ReceiptApplicationDto } from './create-receipt.dto';

export class ApplyReceiptDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiptApplicationDto)
  applications: ReceiptApplicationDto[];
}
