import { Module } from '@nestjs/common';
import { CarteraController } from './cartera.controller';
import { CarteraService } from './cartera.service';
import { PrismaModule } from '../config/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [CarteraController],
  providers: [CarteraService],
  exports: [CarteraService],
})
export class CarteraModule {}
