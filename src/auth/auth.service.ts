import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  companyId: string | null;
  isSuperAdmin: boolean;
  roles: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      include: {
        roles: { include: { role: { include: { permissions: true } } } },
        company: true,
      },
    });

    if (!user || !user.isActive) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    if (user.company && user.company.status === 'SUSPENDED') {
      throw new ForbiddenException('La empresa está suspendida. Contacte soporte.');
    }

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);

    const roles = user.roles.map((ur) => ur.role.name);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      isSuperAdmin: user.isSuperAdmin,
      roles,
    };
    
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(payload),
      this.generateRefreshToken(user.id),
    ]);

    // Save hashed refresh token
    const hashedRefresh = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefresh, lastLoginAt: new Date() },
    });

    // Load full profile (company + active/trial subscription + plan features)
    // so the frontend has everything it needs to gate modules without extra requests.
    const fullProfile = await this.getProfile(user.id);

    return {
      accessToken,
      refreshToken,
      user: fullProfile,
    };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.refreshToken) throw new ForbiddenException('Acceso denegado');

    const valid = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!valid) throw new ForbiddenException('Token de refresco inválido');

    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      isSuperAdmin: user.isSuperAdmin,
      roles: roles.map((r) => r.role.name),
    };

    const [newAccess, newRefresh] = await Promise.all([
      this.generateAccessToken(payload),
      this.generateRefreshToken(user.id),
    ]);

    const hashedRefresh = await bcrypt.hash(newRefresh, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefresh },
    });

    return { accessToken: newAccess, refreshToken: newRefresh };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    return { message: 'Sesión cerrada correctamente' };
  }

  private async generateAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
    });
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      },
    );
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        isSuperAdmin: true,
        hasSeenTour: true,
        companyId: true,
        company: {
          select: {
            id: true,
            name: true,
            nit: true,
            status: true,
            subscriptions: {
              // Include ACTIVE and TRIAL so plan features are always present
              where: { status: { in: ['ACTIVE', 'TRIAL'] } },
              include: {
                plan: {
                  include: { features: true },
                },
              },
              take: 1,
              orderBy: { startDate: 'desc' },
            },
          },
        },
        roles: {
          include: {
            role: {
              include: { permissions: true },
            },
          },
        },
      },
    });

    if (!user) return null;

    // Flatten roles to string[] so the frontend can use them directly
    const roles = user.roles.map((ur) => ur.role.name);

    return { ...user, roles };
  }
}
