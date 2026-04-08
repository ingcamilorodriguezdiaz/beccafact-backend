import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class RequestJournalApprovalDto {
  @ApiPropertyOptional({ description: 'Motivo de solicitud de aprobación' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectJournalApprovalDto {
  @ApiPropertyOptional({ description: 'Motivo del rechazo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AddJournalAttachmentDto {
  @ApiProperty({ description: 'Nombre del archivo adjunto' })
  @IsString()
  @MaxLength(180)
  fileName: string;

  @ApiProperty({ description: 'URL o ruta del soporte documental' })
  @IsString()
  @MaxLength(2000)
  fileUrl: string;
}

export class ReverseJournalEntryDto {
  @ApiPropertyOptional({ description: 'Motivo del reverso controlado' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
