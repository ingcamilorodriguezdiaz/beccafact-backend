import {
  Controller,
  Get,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BanksService } from './banks.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('banks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'banks', version: '1' })
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los bancos activos (catálogo global)' })
  @HttpCode(HttpStatus.OK)
  findAll() {
    return this.banksService.findAll();
  }

  @Get(':code')
  @ApiOperation({ summary: 'Obtener un banco por su código (ej: 001, 007, 023)' })
  @HttpCode(HttpStatus.OK)
  findOne(@Param('code') code: string) {
    return this.banksService.findOne(code);
  }
}
