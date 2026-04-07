import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCollectionFollowUpDto {
  @IsUUID('4', { message: 'El cliente es inválido' })
  customerId: string;

  @IsOptional()
  @IsUUID('4', { message: 'La factura es inválida' })
  invoiceId?: string;

  @IsIn(['CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'NOTE'], {
    message: 'Tipo de gestión inválido',
  })
  activityType: 'CALL' | 'EMAIL' | 'WHATSAPP' | 'VISIT' | 'NOTE';

  @IsString()
  @MaxLength(500)
  outcome: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de próxima gestión es inválida' })
  nextActionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nextAction?: string;
}
