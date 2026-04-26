import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Listar usuarios — formato normalizado para el frontend:
   * cada usuario tiene `roles: string[]` (array de nombres).
   */
  async findAll(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, avatar: true, isActive: true, lastLoginAt: true, createdAt: true,
        roles: { include: { role: { select: { id: true, name: true, displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Normalize: add `roles` as string[] for the frontend
    return users.map((u) => ({
      ...u,
      roles: u.roles.map((ur) => ur.role.name),
    }));
  }

  async findOne(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        roles: { include: { role: { include: { permissions: true } } } },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return {
      ...user,
      roles: user.roles.map((ur) => ur.role.name),
    };
  }

  /** Perfil propio (cualquier usuario autenticado) */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, avatar: true, isActive: true, createdAt: true,
        roles: { include: { role: { select: { name: true, displayName: true } } } },
        company: {
          select: {
            id: true, name: true, nit: true, logoUrl: true,
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIAL'] } },
              include: { plan: { include: { features: true } } },
              orderBy: { startDate: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return {
      ...user,
      roles: user.roles.map((ur) => ur.role.name),
    };
  }

  /** Actualizar perfil propio (nombre, teléfono, avatar) */
  async updateMe(userId: string, dto: UpdateUserDto) {
    const { roleId, isActive, ...allowedData } = dto as any;
    return this.prisma.user.update({
      where: { id: userId },
      data: allowedData,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, avatar: true, updatedAt: true,
      },
    });
  }

  async create(companyId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('El correo ya está registrado');

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          companyId,
        },
      });

      if (dto.roleId) {
        const role = await tx.role.findUnique({ where: { id: dto.roleId } });
        if (!role) throw new NotFoundException('Rol no encontrado');
        await tx.userRole.create({ data: { userId: user.id, roleId: dto.roleId } });
      }

      const created = await tx.user.findUnique({
        where: { id: user.id },
        include: { roles: { include: { role: true } } },
      });
      return { ...created, roles: created!.roles.map((ur) => ur.role.name) };
    });
  }

  async update(companyId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(companyId, id);
    const { roleId, ...data } = dto as any;

    return this.prisma.$transaction(async (tx) => {
      if (roleId !== undefined) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (roleId) {
          await tx.userRole.create({ data: { userId: id, roleId } });
        }
      }
      const updated = await tx.user.update({
        where: { id },
        data,
        include: { roles: { include: { role: true } } },
      });
      return { ...updated, roles: updated.roles.map((ur) => ur.role.name) };
    });
  }

  /**
   * PATCH — acepta isActive (toggle), roleId por nombre o UUID, y campos básicos.
   * El frontend de settings-users usa { isActive: boolean } y { roles: [roleName] }
   */
  async patch(companyId: string, id: string, requesterId: string, dto: UpdateUserDto & { roles?: string[] }) {
    await this.findOne(companyId, id);

    const { roles: roleNames, ...restDto } = dto as any;
    const data: any = { ...restDto };

    return this.prisma.$transaction(async (tx) => {
      // If roles array of strings is passed, resolve to roleId
      if (roleNames?.length) {
        const roleName = roleNames[0];
        const role = await tx.role.findFirst({ where: { name: roleName } });
        if (role) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.userRole.create({ data: { userId: id, roleId: role.id } });
        }
      }

      if (Object.keys(data).length === 0 && !roleNames) {
        return this.findOne(companyId, id);
      }

      const updated = await tx.user.update({
        where: { id },
        data,
        include: { roles: { include: { role: true } } },
      });
      return { ...updated, roles: updated.roles.map((ur) => ur.role.name) };
    });
  }

  async deactivate(companyId: string, id: string, requesterId: string) {
    if (id === requesterId) throw new ForbiddenException('No puedes desactivar tu propia cuenta');
    await this.findOne(companyId, id);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async updatePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new ForbiddenException('Contraseña actual incorrecta');

    const hashed = await bcrypt.hash(newPassword, 12);
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, refreshToken: null },
    });
  }

  async adminUpdatePassword(companyId: string, id: string, requesterId: string, newPassword: string) {
    if (id === requesterId) {
      throw new BadRequestException('Usa la opción de cambiar tu propia contraseña desde Mi perfil');
    }

    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id },
      data: { password: hashed, refreshToken: null },
    });

    return { success: true };
  }

  async markTourSeen(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hasSeenTour: true },
    });
    return { success: true };
  }

  async getRoles() {
    return this.prisma.role.findMany({
      where: { name: { not: 'SUPER_ADMIN' }, isSystem :true },
      include: { permissions: true },
      orderBy: { name: 'asc' },
    });
  }
}
