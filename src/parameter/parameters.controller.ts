import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ParametersService } from './parameters.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('parameters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'parameters', version: '1' })
export class ParametersController {
  constructor(private readonly parametersService: ParametersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar parámetros (opcionalmente filtrar por categoría)' })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Ej: DOCUMENT_TYPES, TAX_RESPONSIBILITIES',
  })
  @HttpCode(HttpStatus.OK)
  findAll(@Query('category') category?: string) {
    return this.parametersService.findAll(category);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Listar todas las categorías disponibles' })
  @HttpCode(HttpStatus.OK)
  findCategories() {
    return this.parametersService.findCategories();
  }

  @Get(':category/map')
  @ApiOperation({ summary: 'Obtener mapa key→value de una categoría (ej: DOCUMENT_TYPES)' })
  @HttpCode(HttpStatus.OK)
  getCategoryMap(@Param('category') category: string) {
    return this.parametersService.getCategoryMap(category);
  }

  @Get(':category')
  @ApiOperation({ summary: 'Obtener un parámetro por categoría' })
  @HttpCode(HttpStatus.OK)
  findOne(@Param('category') category: string) {
    return this.parametersService.findOne(category);
  }
}