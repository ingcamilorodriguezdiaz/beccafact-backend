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
const XLSXStyle = require('xlsx-js-style');

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
  nombre_producto: { label: 'Nombre del Producto *', type: 'text', hint: 'Nombre completo del producto (máx. 255 car.)' },
  sku: { label: 'SKU / Código *', type: 'text', hint: 'Código único. Ej: PROD-001' },
  precio: { label: 'Precio de Venta *', type: 'number', hint: 'Precio en COP. Ej: 50000' },
  categoria: { label: 'Categoría', type: 'text', hint: 'Se crea automáticamente si no existe' },
  costo: { label: 'Costo', type: 'number', hint: 'Precio de costo. Ej: 35000' },
  stock_inicial: { label: 'Stock Inicial', type: 'number', hint: 'Cantidad inicial en inventario' },
  impuesto: { label: 'IVA (%)', type: 'select', hint: '0, 5, 8 o 19', options: ['0', '5', '8', '19'] },
  unidad: { label: 'Unidad de Medida', type: 'select', hint: 'UND, KG, MT, LT, HR, SRV', options: ['UND', 'KG', 'MT', 'LT', 'HR', 'SRV'] },
  descripcion: { label: 'Descripción', type: 'text', hint: 'Descripción del producto (máx. 500 car.)' },
  estado: { label: 'Estado', type: 'select', hint: 'ACTIVE o INACTIVE', options: ['ACTIVE', 'INACTIVE'] },
};

const SAMPLE_PRODUCTS = [
  { nombre_producto: 'Laptop Dell XPS 15', sku: 'DELL-XPS-001', categoria: 'Tecnología', precio: '3500000', costo: '2800000', stock_inicial: '10', impuesto: '19', unidad: 'UND', descripcion: 'Laptop profesional Intel i7', estado: 'ACTIVE' },
  { nombre_producto: 'Monitor LG 27" 4K', sku: 'LG-MON-27-001', categoria: 'Tecnología', precio: '950000', costo: '720000', stock_inicial: '15', impuesto: '19', unidad: 'UND', descripcion: 'Monitor IPS UHD 4K', estado: 'ACTIVE' },
  { nombre_producto: 'Teclado HyperX TKL', sku: 'HX-TKL-001', categoria: 'Periféricos', precio: '280000', costo: '190000', stock_inicial: '25', impuesto: '19', unidad: 'UND', descripcion: 'Mecánico compacto', estado: 'ACTIVE' },
  { nombre_producto: 'Mouse Logitech MX', sku: 'LOG-MX-001', categoria: 'Periféricos', precio: '180000', costo: '125000', stock_inicial: '30', impuesto: '19', unidad: 'UND', descripcion: 'Inalámbrico ergonómico', estado: 'ACTIVE' },
  { nombre_producto: 'Silla Ergonómica Pro', sku: 'SILLA-ERG-001', categoria: 'Mobiliario', precio: '480000', costo: '320000', stock_inicial: '8', impuesto: '19', unidad: 'UND', descripcion: 'Con soporte lumbar', estado: 'ACTIVE' },
  { nombre_producto: 'Resma Papel A4', sku: 'PAPEL-A4-001', categoria: 'Papelería', precio: '18000', costo: '12000', stock_inicial: '100', impuesto: '0', unidad: 'UND', descripcion: '500 hojas 75gr', estado: 'ACTIVE' },
  { nombre_producto: 'Café Premium 500g', sku: 'CAFE-P-001', categoria: 'Consumibles', precio: '35000', costo: '22000', stock_inicial: '50', impuesto: '0', unidad: 'KG', descripcion: 'Café de origen colombiano', estado: 'ACTIVE' },
  { nombre_producto: 'Soporte IT por hora', sku: 'SRV-IT-001', categoria: 'Servicios', precio: '85000', costo: '0', stock_inicial: '0', impuesto: '19', unidad: 'HR', descripcion: 'Soporte técnico especializado', estado: 'ACTIVE' },
];

@Injectable()
export class ImportService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('import') private importQueue: Queue,
  ) { }

  // ─── EXCEL TEMPLATE ──────────────────────────────────────────────────────────
async generateTemplate(
  requestedColumns?: string[],
  customLabels?: Record<string, { label: string; hint: string; sample?: string }>,
): Promise<{ buffer: Buffer; filename: string }> {

  const columnOrder = [
    'nombre_producto',
    'sku',
    'precio',
    'categoria',
    'costo',
    'stock_inicial',
    'impuesto',
    'unidad',
    'descripcion',
    'estado',
  ];

  const columns = requestedColumns?.length
    ? columnOrder.filter(k =>
        requestedColumns.includes(k) ||
        ['nombre_producto', 'sku', 'precio'].includes(k),
      )
    : columnOrder;

  const getMeta = (k: string) => {
    const base = COLUMN_META[k] ?? { label: k, type: 'text', hint: '' };
    const custom = customLabels?.[k];
    return {
      label: custom?.label ?? base.label,
      hint: custom?.hint ?? base.hint,
      type: base.type,
      sample: custom?.sample ?? undefined,
    };
  };

  const wb = XLSXStyle.utils.book_new();

  const wsData: any[][] = [];

  wsData.push([
    'BeccaFact - Plantilla de Importación Masiva de Productos',
    ...Array(columns.length - 1).fill('')
  ]);

  wsData.push(columns.map(k => getMeta(k).label));
  wsData.push(columns.map(k => getMeta(k).hint));

  SAMPLE_PRODUCTS.forEach(product => {
    wsData.push(columns.map(k => {
      const custom = customLabels?.[k];
      return custom?.sample ?? (product as any)[k] ?? '';
    }));
  });

  for (let i = 0; i < 20; i++) {
    wsData.push(columns.map(() => ''));
  }

  const ws = XLSXStyle.utils.aoa_to_sheet(wsData);

  // ───────────────── ESTILOS ─────────────────

  const brandBlue = '1F3A8A';
  const greenHeader = 'dcfce7';
  const blueHeader = 'dbeafe';
  const yellowHint = 'fde68a';
  const headerTextBlue = '1F4E79';

  // Merge título
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } },
  ];

  // 🎯 Fila 1 - Marca
  const brandCell = XLSXStyle.utils.encode_cell({ r: 0, c: 0 });
  ws[brandCell].s = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 },
    fill: { patternType: 'solid', fgColor: { rgb: brandBlue } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };

  // 🎯 Fila 2 - Encabezados
  columns.forEach((key, colIdx) => {
    const cellAddress = XLSXStyle.utils.encode_cell({ r: 1, c: colIdx });
    const isRequired = ['nombre_producto', 'sku', 'precio'].includes(key);

    if (!ws[cellAddress]) return;

    ws[cellAddress].s = {
      font: { bold: true, color: { rgb: headerTextBlue } },
      fill: {
        patternType: 'solid',
        fgColor: { rgb: isRequired ? greenHeader : blueHeader },
      },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      },
    };
  });

  // 🎯 Fila 3 - Descripciones (amarillo)
  columns.forEach((_, colIdx) => {
    const cellAddress = XLSXStyle.utils.encode_cell({ r: 2, c: colIdx });
    if (!ws[cellAddress]) return;

    ws[cellAddress].s = {
      font: { italic: true, color: { rgb: '7F6000' }, sz: 10 },
      fill: {
        patternType: 'solid',
        fgColor: { rgb: yellowHint },
      },
      alignment: { wrapText: true, vertical: 'center' },
      border: {
        bottom: { style: 'thin' },
      },
    };
  });

  // 📏 Ancho columnas
  ws['!cols'] = columns.map(k => {
    const widths: Record<string, number> = {
      nombre_producto: 30,
      sku: 18,
      categoria: 18,
      precio: 15,
      costo: 15,
      stock_inicial: 14,
      impuesto: 10,
      unidad: 12,
      descripcion: 35,
      estado: 12,
    };
    return { wch: widths[k] ?? 16 };
  });

  // 📌 Freeze
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  XLSXStyle.utils.book_append_sheet(wb, ws, 'Productos');

  const buffer = XLSXStyle.write(wb, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;

  const filename =
    `plantilla_productos_beccafact_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
    return csv.parse(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  }

  const wb = XLSX.read(file.buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];

  // 👇 1) Usar fila 2 como headers (range: 1 porque es 0-based)
  const rawRows = XLSX.utils.sheet_to_json<any>(ws, {
    defval: '',
    range: 1, // ignora fila 1 (marca)
  });

  // 👇 2) Eliminar fila 3 (hints/descripciones)
  const dataRows = rawRows.slice(1);

  // Map Spanish labels → field names internos
  const labelMap: Record<string, string> = {
    'Nombre del Producto *': 'nombre_producto',
    'Nombre del Producto': 'nombre_producto',

    'SKU / Código *': 'sku',
    'SKU / Código': 'sku',
    'SKU': 'sku',

    'Precio de Venta *': 'precio',
    'Precio de Venta': 'precio',
    'Precio': 'precio',

    'Categoría': 'categoria',
    'Costo': 'costo',
    'Stock Inicial': 'stock_inicial',
    'IVA (%)': 'impuesto',
    'Unidad de Medida': 'unidad',
    'Descripción': 'descripcion',
    'Estado': 'estado',
  };

  return dataRows
    // 👇 3) Filtrar filas completamente vacías
    .filter((row: any) =>
      Object.values(row).some(value =>
        String(value).trim() !== ''
      )
    )
    // 👇 4) Mapear labels visibles → keys internas
    .map((row: any) => {
      const mapped: any = {};

      for (const [key, value] of Object.entries(row)) {
        const fieldKey = labelMap[key] ?? key;
        mapped[fieldKey] = value;
      }

      return mapped as ProductRow;
    });
}

  private validateRows(rows: ProductRow[]) {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const skus = new Set<string>();
    let validRows = 0;

    rows.forEach((row, index) => {
      const rowNum = index + 4;
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

      if (row.impuesto && !['0', '5', '8', '19'].includes(String(row.impuesto).trim())) {
        errors.push({ row: rowNum, field: 'impuesto', message: `IVA inválido: ${row.impuesto}. Valores permitidos: 0, 5, 8, 19` });
        hasError = true;
      }

      if (row.unidad && !['UND', 'KG', 'MT', 'LT', 'HR', 'SRV'].includes(String(row.unidad).trim().toUpperCase())) {
        errors.push({ row: rowNum, field: 'unidad', message: `Unidad inválida: ${row.unidad}` });
        hasError = true;
      }

      if (!hasError) validRows++;
    });

    return { errors, validRows, errorCount: errors.length };
  }

  async generateErrorReport(
  companyId: string,
  jobId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  // 1. Obtener el Job incluyendo la relación de errores
  const job = await this.prisma.importJob.findFirst({
    where: { id: jobId, companyId },
    include: {
      errors: {
        orderBy: { rowNumber: 'asc' },
      },
    },
  });

  if (!job) throw new NotFoundException('Job de importación no encontrado');

  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Resumen ──────────────────────────────────────────────────────────
  const summaryData: any[][] = [
    ['BeccaFact — Reporte de Errores de Importación'],
    [''],
    ['ID de Operación:', job.id],
    ['Archivo Original:', job.fileName],
    ['Fecha de Inicio:', new Date(job.createdAt).toLocaleString('es-CO')],
    ['Estado Final:', job.status],
    ['Total de Filas:', job.totalRows],
    ['Filas Exitosas:', job.successRows],
    ['Filas con Error:', job.errorRows],
    [''],
    ['Reporte generado el:', new Date().toLocaleString('es-CO')],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  // ── Hoja 2: Detalle de Errores ──────────────────────────────────────────────
  const errorRows: any[][] = [
    ['Detalle de Fallas por Fila'],
    [''],
    ['Fila #', 'Columna/Campo', 'Valor que causó error', 'Descripción del Error'],
  ];

  if (job.errors.length === 0) {
    errorRows.push(['—', '—', '—', 'No se encontraron errores registrados.']);
  } else {
    job.errors.forEach(err => {
      errorRows.push([
        err.rowNumber,
        err.field ?? 'General',
        err.value ?? 'N/A',
        err.message,
      ]);
    });
  }

  const wsErrors = XLSX.utils.aoa_to_sheet(errorRows);
  wsErrors['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 25 }, { wch: 60 }];
  wsErrors['!freeze'] = { xSplit: 0, ySplit: 3 };
  XLSX.utils.book_append_sheet(wb, wsErrors, 'Lista de Errores');

  // ── Hoja 3: Datos para Corregir (Hoja Técnica) ──────────────────────────────
  // Aquí reconstruimos la tabla original para que el usuario pueda editarla
  const originalData: any[][] = [
    ['Filas con Error - Formato de Corrección Masiva'],
    ['Instrucciones: Corrija los datos en esta tabla y vuelva a subir el archivo.'],
    [], // Fila 3 vacía para mantener estética
  ];

  // Agrupar rawData por rowNumber (evita duplicar filas si una fila tuvo varios errores)
  const uniqueErrorRows = Array.from(
    new Map(job.errors.filter(e => e.rawData).map(e => [e.rowNumber, e.rawData])).values()
  );

  if (uniqueErrorRows.length > 0) {
    // Extraer encabezados de las keys de los datos originales
    const headers = Object.keys(uniqueErrorRows[0] as object);
    
    // Mapeo inverso opcional para que los headers vuelvan a ser los del Excel BeccaFact
    const reverseLabelMap: Record<string, string> = {
      nombre_producto: 'Nombre del Producto *',
      sku: 'SKU / Código *',
      precio: 'Precio de Venta *',
      categoria: 'Categoría',
      costo: 'Costo',
      stock_inicial: 'Stock Inicial',
      impuesto: 'IVA (%)',
      unidad: 'Unidad de Medida',
      descripcion: 'Descripción',
      estado: 'Estado'
    };

    const friendlyHeaders = headers.map(h => reverseLabelMap[h] || h);
    originalData.push(['Fila # Original', ...friendlyHeaders]);

    // Llenar datos
    job.errors.filter(e => e.rawData).forEach(err => {
      const data = err.rawData as Record<string, any>;
      const rowValues = headers.map(h => data[h] ?? '');
      originalData.push([err.rowNumber, ...rowValues]);
    });
  } else {
    originalData.push(['No hay datos originales disponibles para reconstruir las filas.']);
  }

  const wsOriginal = XLSX.utils.aoa_to_sheet(originalData);
  // Estilo de columnas: Fila # (8), el resto (22)
  wsOriginal['!cols'] = [{ wch: 15 }, ...Array(15).fill({ wch: 22 })];
  wsOriginal['!freeze'] = { xSplit: 0, ySplit: 4 };
  XLSX.utils.book_append_sheet(wb, wsOriginal, 'Datos para Corregir');

  // ── Generación de Archivo ───────────────────────────────────────────────────
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  
  // Nombre de archivo seguro: errores_nombreoriginal_fecha.xlsx
  const safeName = job.fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]/gi, '_');
  const filename = `REPORTE_ERRORES_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return { buffer, filename };
}
}
