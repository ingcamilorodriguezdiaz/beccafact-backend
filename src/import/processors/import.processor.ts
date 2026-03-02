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

  constructor(private prisma: PrismaService) { }

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
    const BATCH_SIZE = 50; // Reducido ligeramente para mayor estabilidad en la creación de categorías

    let successRows = 0;
    let errorRows = 0;
    const errors: Array<{ rowNumber: number; field?: string; message: string; rawData?: any; value?: string }> = [];

    // 1. Cargar SKUs existentes para evitar duplicados en DB
    const existingSkus = await this.prisma.product.findMany({
      where: { companyId, deletedAt: null },
      select: { sku: true },
    });
    const skuSet = new Set(existingSkus.map((p) => p.sku.toUpperCase()));
    const categoryCache = new Map<string, string>();

    // 2. Procesamiento por lotes
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const validProducts: any[] = [];

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        // Ajuste de fila: +4 (1 Título, 1 Header, 1 Hint, +1 porque Excel es 1-based)
        const rowNumber = i + j + 4;

        try {
          // --- VALIDACIONES DE NEGOCIO ---
          const sku = String(row.sku || '').trim().toUpperCase();
          const nombre = String(row.nombre_producto || '').trim();

          if (!nombre) throw new Error('El nombre del producto es obligatorio');
          if (!sku) throw new Error('El SKU es obligatorio');

          if (skuSet.has(sku)) {
            errors.push({
              rowNumber,
              field: 'sku',
              message: `El SKU "${sku}" ya existe en el sistema o está duplicado en el archivo`,
              rawData: row,
              value: sku
            });
            errorRows++;
            continue;
          }

          // --- GESTIÓN DE CATEGORÍAS ---
          let categoryId: string | undefined;
          if (row.categoria && String(row.categoria).trim() !== '') {
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

          // --- LIMPIEZA DE NUMÉRICOS (Remueve $, comas y espacios) ---
          const cleanNumber = (val: any) => String(val || '0').replace(/[^0-9.]/g, '');

          const price = parseFloat(cleanNumber(row.precio));
          const cost = row.costo ? parseFloat(cleanNumber(row.costo)) : 0;
          const stock = row.stock_inicial ? parseInt(cleanNumber(row.stock_inicial)) : 0;

          // Impuesto: Si viene "19%", extraer solo "19"
          const taxRate = row.impuesto ? parseFloat(cleanNumber(row.impuesto)) : 19;

          if (isNaN(price)) throw new Error('El precio tiene un formato inválido');

          validProducts.push({
            companyId,
            sku,
            name: nombre,
            categoryId,
            price,
            cost,
            stock,
            taxRate,
            description: row.descripcion ? String(row.descripcion).trim() : null,
            unit: row.unidad ? String(row.unidad).trim().toUpperCase() : 'UND',
            status: String(row.estado).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
          });

          skuSet.add(sku);
          successRows++;
        } catch (e) {
          errors.push({
            rowNumber,
            field: 'General',
            message: e.message,
            rawData: row
          });
          errorRows++;
        }
      }

      // 3. Inserción masiva del lote
      if (validProducts.length > 0) {
        await this.prisma.product.createMany({
          data: validProducts,
          skipDuplicates: true
        });
      }

      // 4. Actualizar progreso del Job
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

    // 5. Guardar errores detallados para el reporte Excel
    if (errors.length > 0) {
      await this.prisma.importError.createMany({
        data: errors.map((e) => ({
          importJobId,
          rowNumber: e.rowNumber,
          field: e.field || 'desconocido',
          message: e.message,
          value: e.value || 'N/A',
          rawData: e.rawData || {}, // Importante para la Hoja 3 del reporte
        })),
      });
    }

    // 6. Finalización del estado
    const finalStatus = successRows > 0 ? 'COMPLETED' : 'ERROR';

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: finalStatus,
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
