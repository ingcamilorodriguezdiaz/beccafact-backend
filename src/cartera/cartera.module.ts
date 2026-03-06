import { Module } from '@nestjs/common';
import { CarteraController } from './cartera.controller';
import { CarteraService } from './cartera.service';
import { PrismaModule } from '../config/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CarteraController],
  providers: [CarteraService],
  exports: [CarteraService],
})
export class CarteraModule {}
