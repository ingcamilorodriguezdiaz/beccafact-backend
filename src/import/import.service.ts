import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../config/prisma.service';
import * as csv from 'csv-parse/sync';
import * as XLSX from 'xlsx';

export interface ProductRow {
  nombre_producto: string;
  sku: string;
  categoria?: string;
  precio: string;
  costo?: string;
  stock_inicial?: string;
  impuesto?: string;
  unidad?: string;
  descripcion?: string;
  estado?: string;
}

// All available columns with metadata
const COLUMN_META: Record<string, { label: string; type: string; hint: string; options?: string[] }> = {
  nombre_producto: { label: 'Nombre del Producto *', type: 'text',   hint: 'Nombre completo del producto (máx. 255 car.)' },
  sku:             { label: 'SKU / Código *',         type: 'text',   hint: 'Código único. Ej: PROD-001' },
  precio:          { label: 'Precio de Venta *',      type: 'number', hint: 'Precio en COP. Ej: 50000' },
  categoria:       { label: 'Categoría',              type: 'text',   hint: 'Se crea automáticamente si no existe' },
  costo:           { label: 'Costo',                  type: 'number', hint: 'Precio de costo. Ej: 35000' },
  stock_inicial:   { label: 'Stock Inicial',          type: 'number', hint: 'Cantidad inicial en inventario' },
  impuesto:        { label: 'IVA (%)',                type: 'select', hint: '0, 5, 8 o 19', options: ['0','5','8','19'] },
  unidad:          { label: 'Unidad de Medida',       type: 'select', hint: 'UND, KG, MT, LT, HR, SRV', options: ['UND','KG','MT','LT','HR','SRV'] },
  descripcion:     { label: 'Descripción',            type: 'text',   hint: 'Descripción del producto (máx. 500 car.)' },
  estado:          { label: 'Estado',                 type: 'select', hint: 'ACTIVE o INACTIVE', options: ['ACTIVE','INACTIVE'] },
};

const SAMPLE_PRODUCTS = [
  { nombre_producto: 'Laptop Dell XPS 15',  sku: 'DELL-XPS-001',  categoria: 'Tecnología',    precio: '3500000', costo: '2800000', stock_inicial: '10', impuesto: '19', unidad: 'UND', descripcion: 'Laptop profesional Intel i7', estado: 'ACTIVE' },
  { nombre_producto: 'Monitor LG 27" 4K',   sku: 'LG-MON-27-001', categoria: 'Tecnología',    precio: '950000',  costo: '720000',  stock_inicial: '15', impuesto: '19', unidad: 'UND', descripcion: 'Monitor IPS UHD 4K',         estado: 'ACTIVE' },
  { nombre_producto: 'Teclado HyperX TKL',  sku: 'HX-TKL-001',   categoria: 'Periféricos',   precio: '280000',  costo: '190000',  stock_inicial: '25', impuesto: '19', unidad: 'UND', descripcion: 'Mecánico compacto',           estado: 'ACTIVE' },
  { nombre_producto: 'Mouse Logitech MX',   sku: 'LOG-MX-001',    categoria: 'Periféricos',   precio: '180000',  costo: '125000',  stock_inicial: '30', impuesto: '19', unidad: 'UND', descripcion: 'Inalámbrico ergonómico',      estado: 'ACTIVE' },
  { nombre_producto: 'Silla Ergonómica Pro',sku: 'SILLA-ERG-001', categoria: 'Mobiliario',    precio: '480000',  costo: '320000',  stock_inicial: '8',  impuesto: '19', unidad: 'UND', descripcion: 'Con soporte lumbar',          estado: 'ACTIVE' },
  { nombre_producto: 'Resma Papel A4',       sku: 'PAPEL-A4-001',  categoria: 'Papelería',     precio: '18000',   costo: '12000',   stock_inicial: '100',impuesto: '0',  unidad: 'UND', descripcion: '500 hojas 75gr',              estado: 'ACTIVE' },
  { nombre_producto: 'Café Premium 500g',   sku: 'CAFE-P-001',    categoria: 'Consumibles',   precio: '35000',   costo: '22000',   stock_inicial: '50', impuesto: '0',  unidad: 'KG',  descripcion: 'Café de origen colombiano',   estado: 'ACTIVE' },
  { nombre_producto: 'Soporte IT por hora', sku: 'SRV-IT-001',    categoria: 'Servicios',     precio: '85000',   costo: '0',       stock_inicial: '0',  impuesto: '19', unidad: 'HR',  descripcion: 'Soporte técnico especializado',estado: 'ACTIVE' },
];

@Injectable()
export class ImportService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('import') private importQueue: Queue,
  ) {}

  // ─── EXCEL TEMPLATE ──────────────────────────────────────────────────────────

  async generateTemplate(
    requestedColumns?: string[],
    customLabels?: Record<string, { label: string; hint: string; sample?: string }>,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // Default column order if none specified
    const columnOrder = ['nombre_producto', 'sku', 'precio', 'categoria', 'costo', 'stock_inicial', 'impuesto', 'unidad', 'descripcion', 'estado'];
    const columns = requestedColumns?.length
      ? columnOrder.filter(k => requestedColumns.includes(k) || ['nombre_producto','sku','precio'].includes(k))
      : columnOrder;

    // Merge custom labels over defaults
    const getMeta = (k: string) => {
      const base = COLUMN_META[k] ?? { label: k, type: 'text', hint: '' };
      const custom = customLabels?.[k];
      return {
        label:  custom?.label  ?? base.label,
        hint:   custom?.hint   ?? base.hint,
        type:   base.type,
        sample: custom?.sample ?? undefined,
      };
    };

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Productos ─────────────────────────────────────────────────────
    const wsData: any[][] = [];

    // Brand header row
    wsData.push(['BeccaFact - Plantilla de Importación Masiva de Productos', ...Array(columns.length - 1).fill('')]);

    // Column headers (uses custom labels if provided)
    wsData.push(columns.map(k => getMeta(k).label));

    // Hint row (uses custom hints if provided)
    wsData.push(columns.map(k => getMeta(k).hint));

    // Sample data rows (custom sample overrides built-in)
    SAMPLE_PRODUCTS.forEach(product => {
      wsData.push(columns.map(k => {
        const custom = customLabels?.[k];
        return custom?.sample ?? (product as any)[k] ?? '';
      }));
    });

    // 20 empty data rows
    for (let i = 0; i < 20; i++) {
      wsData.push(columns.map(() => ''));
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws['!cols'] = columns.map(k => {
      const widths: Record<string, number> = { nombre_producto: 30, sku: 18, categoria: 18, precio: 15, costo: 15, stock_inicial: 14, impuesto: 10, unidad: 12, descripcion: 35, estado: 12 };
      return { wch: widths[k] ?? 16 };
    });

    // Freeze panes: freeze first 3 rows (brand + headers + hints)
    ws['!freeze'] = { xSplit: 0, ySplit: 3 };

    // Add data validation for select columns
    if (!ws['!dataValidation']) ws['!dataValidation'] = [];
    columns.forEach((key, colIdx) => {
      const meta = COLUMN_META[key];
      if (meta?.options) {
        const colLetter = XLSX.utils.encode_col(colIdx);
        ws['!dataValidation'].push({
          sqref: `${colLetter}4:${colLetter}10003`,
          type: 'list',
          formula1: `"${meta.options.join(',')}"`,
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: `Valores permitidos: ${meta.options.join(', ')}`,
        });
      }
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Productos');

    // ── Sheet 2: Instrucciones ─────────────────────────────────────────────────
    const instrData: any[][] = [
      ['BeccaFact — Guía de Importación Masiva'],
      [''],
      ['CAMPOS DISPONIBLES'],
      ['Campo', 'Requerido', 'Tipo', 'Descripción', 'Ejemplo'],
    ];

    Object.entries(COLUMN_META).forEach(([key, meta]) => {
      const required = ['nombre_producto','sku','precio'].includes(key);
      instrData.push([
        key,
        required ? 'SÍ ✓' : 'No',
        meta.type,
        meta.hint,
        (SAMPLE_PRODUCTS[0] as any)[key] ?? '',
      ]);
    });

    instrData.push([''], ['REGLAS IMPORTANTES'], ['']);
    [
      '1. Las columnas marcadas como requeridas (SÍ ✓) son obligatorias.',
      '2. El SKU debe ser único. No puede repetirse dentro del archivo.',
      '3. Las categorías se crean automáticamente si no existen en el sistema.',
      '4. El límite máximo de filas por importación es 10.000 productos.',
      '5. Los valores de IVA permitidos son: 0, 5, 8, 19.',
      '6. Los valores de unidad permitidos son: UND, KG, MT, LT, HR, SRV.',
      '7. El estado puede ser ACTIVE o INACTIVE (por defecto ACTIVE).',
      '8. Los precios deben ser valores numéricos sin separadores de miles.',
      '9. La primera fila válida de datos empieza en la fila 4 (después de cabeceras y hints).',
      '10. Usa la hoja "Datos Válidos" como referencia rápida.',
    ].forEach(rule => instrData.push([rule]));

    const wsInstr = XLSX.utils.aoa_to_sheet(instrData);
    wsInstr['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 45 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

    // ── Sheet 3: Datos Válidos ─────────────────────────────────────────────────
    const datosData: any[][] = [
      ['REFERENCIA DE VALORES VÁLIDOS'],
      [''],
      ['IVA (%)', '', 'Unidad', '', 'Estado', '', 'Moneda'],
      ['0 — Sin IVA', '', 'UND — Unidad',    '', 'ACTIVE — Activo',   '', 'COP — Peso colombiano'],
      ['5 — IVA 5%',  '', 'KG  — Kilogramo', '', 'INACTIVE — Inactivo','', 'USD — Dólar americano'],
      ['8 — IVA 8%',  '', 'MT  — Metro',     '', '', '', ''],
      ['19 — IVA 19%','', 'LT  — Litro',     '', '', '', ''],
      ['', '', 'HR  — Hora',      '', '', '', ''],
      ['', '', 'SRV — Servicio',  '', '', '', ''],
    ];

    const wsDatos = XLSX.utils.aoa_to_sheet(datosData);
    wsDatos['!cols'] = [{ wch: 22 }, { wch: 3 }, { wch: 20 }, { wch: 3 }, { wch: 22 }, { wch: 3 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsDatos, 'Datos Válidos');

    // Write to buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `plantilla_productos_beccafact_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return { buffer, filename };
  }

  // ─── PREVIEW & UPLOAD ────────────────────────────────────────────────────────

  async parsePreview(file: Express.Multer.File, companyId: string) {
    const rows = this.parseFile(file);

    if (rows.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }

    const preview = rows.slice(0, 10);
    const validationResults = this.validateRows(rows);

    return {
      totalRows: rows.length,
      validRows: validationResults.validRows,
      errorRows: validationResults.errorCount,
      previewRows: preview,
      errors: validationResults.errors.slice(0, 50),
      headers: Object.keys(rows[0] || {}),
    };
  }

  async createImportJob(
    file: Express.Multer.File,
    companyId: string,
    userId: string,
  ) {
    const rows = this.parseFile(file);

    const importJob = await this.prisma.importJob.create({
      data: {
        companyId,
        userId,
        type: 'PRODUCTS',
        fileName: file.originalname,
        fileUrl: '',
        totalRows: rows.length,
        status: 'PENDING',
      },
    });

    await this.importQueue.add(
      'process-products',
      { importJobId: importJob.id, companyId, rows },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return importJob;
  }

  async getJobStatus(companyId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, companyId },
      include: { errors: { take: 100, orderBy: { rowNumber: 'asc' } } },
    });
    if (!job) throw new NotFoundException('Import job no encontrado');
    return job;
  }

  async getHistory(companyId: string, page = 1, limit = 10) {
    const skip = (page - 1) * +limit;
    const [data, total] = await Promise.all([
      this.prisma.importJob.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: +limit,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.importJob.count({ where: { companyId } }),
    ]);
    return { data, total, page: +page, limit: +limit };
  }

  async cancelJob(companyId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, companyId, status: 'PENDING' },
    });
    if (!job) throw new NotFoundException('Job no encontrado o no puede cancelarse');

    await this.importQueue.removeJobs(jobId);
    return this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED' },
    });
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────────────────

  private parseFile(file: Express.Multer.File): ProductRow[] {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      return csv.parse(file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    } else {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });

      // Map Spanish labels → field names
      const labelMap: Record<string, string> = {
        'Nombre del Producto *': 'nombre_producto', 'Nombre del Producto': 'nombre_producto',
        'SKU / Código *': 'sku', 'SKU / Código': 'sku', 'SKU': 'sku',
        'Precio de Venta *': 'precio', 'Precio de Venta': 'precio', 'Precio': 'precio',
        'Categoría': 'categoria', 'Costo': 'costo', 'Stock Inicial': 'stock_inicial',
        'IVA (%)': 'impuesto', 'Unidad de Medida': 'unidad', 'Descripción': 'descripcion', 'Estado': 'estado',
      };

      return rawRows
        .filter((row: any) => {
          const first = Object.values(row)[0] as string;
          return first && !first.includes('BeccaFact') && !first.includes('Nombre completo');
        })
        .map((row: any) => {
          const mapped: any = {};
          for (const [key, value] of Object.entries(row)) {
            const fieldKey = labelMap[key] ?? key;
            mapped[fieldKey] = value;
          }
          return mapped as ProductRow;
        });
    }
  }

  private validateRows(rows: ProductRow[]) {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const skus = new Set<string>();
    let validRows = 0;

    rows.forEach((row, index) => {
      const rowNum = index + 2;
      let hasError = false;

      if (!row.nombre_producto?.trim()) {
        errors.push({ row: rowNum, field: 'nombre_producto', message: 'El nombre es requerido' });
        hasError = true;
      }

      if (!row.sku?.trim()) {
        errors.push({ row: rowNum, field: 'sku', message: 'El SKU es requerido' });
        hasError = true;
      } else if (skus.has(row.sku.trim().toUpperCase())) {
        errors.push({ row: rowNum, field: 'sku', message: `SKU duplicado en el archivo: ${row.sku}` });
        hasError = true;
      } else {
        skus.add(row.sku.trim().toUpperCase());
      }

      const price = parseFloat(String(row.precio).replace(/[^0-9.]/g, ''));
      if (isNaN(price) || price < 0) {
        errors.push({ row: rowNum, field: 'precio', message: 'Precio inválido' });
        hasError = true;
      }

      if (row.impuesto && !['0','5','8','19'].includes(String(row.impuesto).trim())) {
        errors.push({ row: rowNum, field: 'impuesto', message: `IVA inválido: ${row.impuesto}. Valores permitidos: 0, 5, 8, 19` });
        hasError = true;
      }

      if (row.unidad && !['UND','KG','MT','LT','HR','SRV'].includes(String(row.unidad).trim().toUpperCase())) {
        errors.push({ row: rowNum, field: 'unidad', message: `Unidad inválida: ${row.unidad}` });
        hasError = true;
      }

      if (!hasError) validRows++;
    });

    return { errors, validRows, errorCount: errors.length };
  }
}
