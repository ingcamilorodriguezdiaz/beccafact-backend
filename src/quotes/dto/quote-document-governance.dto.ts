import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class CreateQuoteAttachmentDto {
  @ApiProperty({ example: 'Ficha técnica.pdf' })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'https://cdn.beccafact.com/quotes/ficha-tecnica.pdf' })
  @IsUrl()
  fileUrl: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @ApiPropertyOptional({ example: 'SOPORTE' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ example: 'Documento enviado por el fabricante' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 241231 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

export class CreateQuoteCommentDto {
  @ApiPropertyOptional({ example: 'INTERNAL' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  commentType?: string;

  @ApiProperty({ example: 'El cliente pidió ajustar el alcance antes de enviar la propuesta final.' })
  @IsString()
  @MaxLength(4000)
  message: string;
}
