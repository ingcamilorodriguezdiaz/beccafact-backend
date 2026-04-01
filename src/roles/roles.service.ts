import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

/** Roles del sistema que no se pueden eliminar */
const SYSTEM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'CAJERO'];

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /** Listar todos los roles excepto SUPER_ADMIN */
  async findAll() {
    return this.prisma.role.findMany({
      where: { name: { not: 'SUPER_ADMIN' } },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        permissions: {
          select: { id: true, action: true, resource: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Obtener un rol con todos sus permisos */
  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id }
    });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (role.name === 'SUPER_ADMIN') throw new ForbiddenException('Rol no accesible');
    return role;
  }

  /** Crear un rol nuevo con permisos opcionales */
  async create(data: any) {
    const { permissions, ...roleData } = data;

    const existing = await this.prisma.role.findFirst({
      where: { name: roleData.name },
    });
    if (existing) throw new ConflictException('Ya existe un rol con ese nombre');

    return this.prisma.role.create({
      data: {
        ...roleData,
        permissions: permissions
          ? { create: permissions }
          : undefined,
      },
      include: { permissions: true },
    });
  }

 

  /** Eliminar rol solo si no es del sistema y no tiene usuarios asignados */
  async remove(id: string) {
    const role = await this.findOne(id);

    if (SYSTEM_ROLES.includes(role.name)) {
      throw new ForbiddenException('No se pueden eliminar roles del sistema');
    }

    const usersWithRole = await this.prisma.userRole.count({ where: { roleId: id } });
    if (usersWithRole > 0) {
      throw new ConflictException(
        `El rol tiene ${usersWithRole} usuario(s) asignado(s). Reasígnelos antes de eliminar.`,
      );
    }

    await this.prisma.role.delete({ where: { id } });
    return { message: 'Rol eliminado correctamente' };
  }
}
