import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportProcessor } from './processors/import.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'import' }),
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (req, file, cb) => {
        const allowed = [
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Solo se permiten archivos CSV o XLSX'), false);
        }
      },
    }),
  ],
  controllers: [ImportController],
  providers: [ImportService, ImportProcessor],
})
export class ImportModule {}
