import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../config/prisma.service';

interface ImportJobData {
  importJobId: string;
  companyId: string;
  rows: any[];
}

@Processor('import')
export class ImportProcessor {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private prisma: PrismaService) {}

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`Processing import job ${job.data.importJobId}`);
    this.prisma.importJob.update({
      where: { id: job.data.importJobId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
  }

  @Process('process-products')
  async processProducts(job: Job<ImportJobData>) {
    const { importJobId, companyId, rows } = job.data;
    const BATCH_SIZE = 100;

    let successRows = 0;
    let errorRows = 0;
    const errors: Array<{ rowNumber: number; field?: string; message: string; rawData?: any }> = [];

    // Get existing SKUs for this company to detect duplicates
    const existingSkus = await this.prisma.product.findMany({
      where: { companyId, deletedAt: null },
      select: { sku: true },
    });
    const skuSet = new Set(existingSkus.map((p) => p.sku.toUpperCase()));

    // Get or create categories
    const categoryCache = new Map<string, string>(); // name -> id

    // Process in batches
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const validProducts: any[] = [];

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const rowNumber = i + j + 2;

        try {
          const sku = String(row.sku || '').trim().toUpperCase();

          if (skuSet.has(sku)) {
            errors.push({ rowNumber, field: 'sku', message: `SKU ya existe: ${sku}`, rawData: row });
            errorRows++;
            continue;
          }

          let categoryId: string | undefined;
          if (row.categoria) {
            const catName = String(row.categoria).trim();
            if (!categoryCache.has(catName)) {
              const cat = await this.prisma.category.upsert({
                where: { companyId_name: { companyId, name: catName } },
                create: { companyId, name: catName },
                update: {},
              });
              categoryCache.set(catName, cat.id);
            }
            categoryId = categoryCache.get(catName);
          }

          const price = parseFloat(String(row.precio).replace(/[^0-9.]/g, ''));
          const cost = row.costo ? parseFloat(String(row.costo).replace(/[^0-9.]/g, '')) : 0;
          const stock = row.stock_inicial ? parseInt(String(row.stock_inicial)) : 0;
          const taxRate = row.impuesto ? parseFloat(String(row.impuesto)) : 19;

          validProducts.push({
            companyId,
            sku,
            name: String(row.nombre_producto).trim(),
            categoryId,
            price,
            cost,
            stock,
            taxRate,
            status: row.estado === 'inactivo' ? 'INACTIVE' : 'ACTIVE',
          });

          skuSet.add(sku);
          successRows++;
        } catch (e) {
          errors.push({ rowNumber, message: e.message, rawData: row });
          errorRows++;
        }
      }

      // Batch insert
      if (validProducts.length > 0) {
        await this.prisma.product.createMany({ data: validProducts, skipDuplicates: true });
      }

      // Update progress
      await this.prisma.importJob.update({
        where: { id: importJobId },
        data: {
          processedRows: Math.min(i + BATCH_SIZE, rows.length),
          successRows,
          errorRows,
        },
      });

      await job.progress(Math.round(((i + BATCH_SIZE) / rows.length) * 100));
    }

    // Save errors
    if (errors.length > 0) {
      await this.prisma.importError.createMany({
        data: errors.map((e) => ({
          importJobId,
          rowNumber: e.rowNumber,
          field: e.field,
          message: e.message,
          rawData: e.rawData,
        })),
      });
    }

    // Finalize job
    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: errorRows > 0 && successRows === 0 ? 'ERROR' : 'COMPLETED',
        completedAt: new Date(),
        successRows,
        errorRows,
        processedRows: rows.length,
      },
    });

    return { successRows, errorRows };
  }

  @OnQueueFailed()
  async onFailed(job: Job<ImportJobData>, error: Error) {
    this.logger.error(`Import job ${job.data.importJobId} failed: ${error.message}`);
    await this.prisma.importJob.update({
      where: { id: job.data.importJobId },
      data: { status: 'ERROR', completedAt: new Date() },
    });
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`Import job ${job.data.importJobId} completed`);
  }
}
