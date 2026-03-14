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
import { LocationService } from './location.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('location')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  // ─── Countries ────────────────────────────────────────────────────────────────

  @Get('countries')
  @ApiOperation({ summary: 'Listar todos los países (249 registros, ISO 3166-1 alpha-2)' })
  @HttpCode(HttpStatus.OK)
  findAllCountries() {
    return this.locationService.findAllCountries();
  }

  @Get('countries/:code')
  @ApiOperation({ summary: 'Obtener un país por código ISO (ej: CO, US, MX)' })
  @HttpCode(HttpStatus.OK)
  findCountry(@Param('code') code: string) {
    return this.locationService.findCountryByCode(code);
  }

  // ─── Departments ──────────────────────────────────────────────────────────────

  @Get('departments')
  @ApiOperation({ summary: 'Listar departamentos de Colombia (33 registros DIVIPOLA)' })
  @ApiQuery({ name: 'countryCode', required: false, description: 'ISO country code (default: CO)' })
  @HttpCode(HttpStatus.OK)
  findAllDepartments(@Query('countryCode') countryCode?: string) {
    return this.locationService.findAllDepartments(countryCode ?? 'CO');
  }

  @Get('departments/:code')
  @ApiOperation({ summary: 'Obtener un departamento por código DIVIPOLA (ej: 05, 11, 25)' })
  @HttpCode(HttpStatus.OK)
  findDepartment(@Param('code') code: string) {
    return this.locationService.findDepartmentByCode(code);
  }

  @Get('departments/:code/municipalities')
  @ApiOperation({ summary: 'Listar municipios de un departamento por código DIVIPOLA' })
  @HttpCode(HttpStatus.OK)
  findMunicipalitiesByDepartment(@Param('code') code: string) {
    return this.locationService.findMunicipalitiesByDepartment(code);
  }

  // ─── Municipalities ───────────────────────────────────────────────────────────

  @Get('municipalities/search')
  @ApiOperation({ summary: 'Buscar municipios por nombre (max 50 resultados)' })
  @ApiQuery({ name: 'q',              required: true,  description: 'Texto a buscar en nombre del municipio' })
  @ApiQuery({ name: 'departmentCode', required: false, description: 'Filtrar por código de departamento' })
  @HttpCode(HttpStatus.OK)
  searchMunicipalities(
    @Query('q') search: string,
    @Query('departmentCode') departmentCode?: string,
  ) {
    return this.locationService.searchMunicipalities(search, departmentCode);
  }

  @Get('municipalities/:code')
  @ApiOperation({ summary: 'Obtener un municipio por código DIVIPOLA (ej: 05001, 11001, 25473)' })
  @HttpCode(HttpStatus.OK)
  findMunicipality(@Param('code') code: string) {
    return this.locationService.findMunicipalityByCode(code);
  }
}
