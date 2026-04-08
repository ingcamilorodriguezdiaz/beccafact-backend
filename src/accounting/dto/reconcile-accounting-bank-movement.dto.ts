import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ReconcileAccountingBankMovementDto {
  @ApiProperty({ description: 'Comprobante contable contra el cual se concilia el movimiento bancario' })
  @IsUUID()
  entryId: string;
}
