import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { PosDocumentModeDto } from './create-pos-sale.dto';

export class DeliverSaleDto {
  @IsOptional()
  @IsString()
  notes?: string;

  /** Si true y la venta está completamente pagada y tiene cliente, genera factura automáticamente. */
  @IsOptional()
  @IsBoolean()
  generateInvoice?: boolean;

  /** Define si al entregar se genera POS electrónico o factura electrónica. */
  @IsOptional()
  @IsEnum(PosDocumentModeDto)
  documentMode?: PosDocumentModeDto;
}
