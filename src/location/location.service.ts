import { PrismaService } from '@/config/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Countries ────────────────────────────────────────────────────────────────

  async findAllCountries() {
    return this.prisma.country.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    });
  }

  async findCountryByCode(code: string) {
    const country = await this.prisma.country.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!country) throw new NotFoundException(`País con código ${code} no encontrado`);
    return country;
  }

  // ─── Departments ──────────────────────────────────────────────────────────────

  async findAllDepartments(countryCode = 'CO') {
    return this.prisma.department.findMany({
      where: { countryCode, isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true, countryCode: true },
    });
  }

  async findDepartmentByCode(code: string) {
    const dept = await this.prisma.department.findUnique({
      where: { code },
      include: { country: { select: { code: true, name: true } } },
    });
    if (!dept) throw new NotFoundException(`Departamento con código ${code} no encontrado`);
    return dept;
  }

  // ─── Municipalities ───────────────────────────────────────────────────────────

  async findMunicipalitiesByDepartment(departmentCode: string) {
    // Verificar que el departamento existe
    const dept = await this.prisma.department.findUnique({ where: { code: departmentCode } });
    if (!dept) throw new NotFoundException(`Departamento ${departmentCode} no encontrado`);

    return this.prisma.municipality.findMany({
      where: { departmentCode, isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true, departmentCode: true },
    });
  }

  async findMunicipalityByCode(code: string) {
    const muni = await this.prisma.municipality.findUnique({
      where: { code },
      include: {
        department: {
          select: {
            code: true,
            name: true,
            country: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!muni) throw new NotFoundException(`Municipio con código DIVIPOLA ${code} no encontrado`);
    return muni;
  }

  async searchMunicipalities(search: string, departmentCode?: string) {
    return this.prisma.municipality.findMany({
      where: {
        isActive: true,
        ...(departmentCode ? { departmentCode } : {}),
        name: { contains: search, mode: 'insensitive' },
      },
      orderBy: [{ departmentCode: 'asc' }, { name: 'asc' }],
      take: 50,
      select: {
        code: true,
        name: true,
        departmentCode: true,
        department: { select: { name: true } },
      },
    });
  }

  /**
   * Dado un código DIVIPOLA de municipio, devuelve el código de departamento (2 dígitos).
   * Útil para el XML DIAN: CountrySubentityCode.
   */
  getDepartmentCodeFromMunicipality(municipalityCode: string): string {
    return municipalityCode.slice(0, 2);
  }
}
