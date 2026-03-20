import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { BankResponseDto } from './dto/bank.dto';

@Injectable()
export class BanksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve todos los bancos activos ordenados por código ASC */
  async findAll(): Promise<BankResponseDto[]> {
    return this.prisma.bank.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
      },
    });
  }

  /** Devuelve un banco por su código */
  async findOne(code: string): Promise<BankResponseDto> {
    const bank = await this.prisma.bank.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
      },
    });

    if (!bank) {
      throw new NotFoundException(`Banco con código ${code} no encontrado`);
    }

    return bank;
  }
}
