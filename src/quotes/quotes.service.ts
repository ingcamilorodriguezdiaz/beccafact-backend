import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  AlignmentType,
  BorderStyle,
  WidthType,
  HeadingLevel,
  ShadingType,
  TableLayoutType,
  VerticalAlign,
} from 'docx';
import { PrismaService } from '../config/prisma.service';
import { MailerService } from '../common/mailer/mailer.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { RequestQuoteApprovalDto } from './dto/request-quote-approval.dto';
import { RejectQuoteApprovalDto } from './dto/reject-quote-approval.dto';
import { CreateQuoteFollowUpDto } from './dto/create-quote-followup.dto';
import {
  CreateCommercialMasterDto,
  CreateQuotePriceListDto,
  CreateQuoteTemplateDto,
  UpdateCommercialMasterDto,
  UpdateQuotePriceListDto,
  UpdateQuoteTemplateDto,
} from './dto/commercial-masters.dto';
import { CreateQuoteApprovalPolicyDto, UpdateQuoteApprovalPolicyDto } from './dto/quote-approval-policy.dto';
import { CreateQuoteAttachmentDto, CreateQuoteCommentDto } from './dto/quote-document-governance.dto';

// Estados que permiten modificaciones (editar, eliminar)
const MUTABLE_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT'];
const APPROVAL_TOTAL_THRESHOLD = 5_000_000;
const APPROVAL_DISCOUNT_THRESHOLD = 10;

type QuoteApprovalRow = {
  id: string;
  quoteId: string;
  status: string;
  reason: string;
  sequence: number;
  policyName: string | null;
  requiredRole: string | null;
  thresholdType: string | null;
  thresholdValue: any;
  requestedById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type QuoteVersionRow = {
  id: string;
  quoteId: string;
  versionNumber: number;
  action: string;
  snapshot: any;
  createdById: string | null;
  createdAt: Date;
};

type QuoteFollowUpRow = {
  id: string;
  quoteId: string;
  activityType: string;
  notes: string;
  scheduledAt: Date | null;
  createdById: string | null;
  createdAt: Date;
};

type QuoteAttachmentRow = {
  id: string;
  quoteId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  category: string | null;
  notes: string | null;
  sizeBytes: number | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type QuoteCommentRow = {
  id: string;
  quoteId: string;
  commentType: string;
  message: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type QuoteAuditTrailRow = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  before: any;
  after: any;
  userId: string | null;
  createdAt: Date;
  userName: string | null;
};

type QuoteInventoryIntegrationRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  status: string;
  stock: number;
  minStock: number;
};

type CommercialMasterKind = 'salesOwner' | 'sourceChannel' | 'lostReason' | 'stage';

type CommercialMasterRow = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  email?: string | null;
  phone?: string | null;
  code?: string | null;
  color?: string | null;
  position?: number | null;
  isDefault?: boolean | null;
  isClosed?: boolean | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PriceListRow = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PriceListItemRow = {
  id: string;
  priceListId: string;
  productId: string | null;
  description: string;
  unitPrice: any;
  taxRate: any;
  position: number;
};

type TemplateRow = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  notes: string | null;
  terms: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type TemplateItemRow = {
  id: string;
  templateId: string;
  productId: string | null;
  description: string;
  quantity: any;
  unitPrice: any;
  taxRate: any;
  discount: any;
  position: number;
};

type QuoteAdvancedCommercialRow = {
  id: string;
  paymentTermLabel: string | null;
  paymentTermDays: number | null;
  deliveryLeadTimeDays: number | null;
  deliveryTerms: string | null;
  incotermCode: string | null;
  incotermLocation: string | null;
  exchangeRate: any;
  commercialConditions: string | null;
};

type QuoteApprovalPolicyRow = {
  id: string;
  companyId: string;
  name: string;
  approvalType: 'TOTAL' | 'DISCOUNT';
  thresholdValue: any;
  requiredRole: string;
  sequence: number;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);
  private readonly masterTableMap: Record<CommercialMasterKind, string> = {
    salesOwner: 'quote_sales_owners',
    sourceChannel: 'quote_source_channels',
    lostReason: 'quote_lost_reasons',
    stage: 'quote_stages',
  };

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private invoicesService: InvoicesService,
  ) {}

  async getCommercialMasters(companyId: string) {
    const [salesOwners, sourceChannels, lostReasons, stages, priceLists, templates] = await Promise.all([
      this.listCommercialMaster(companyId, 'salesOwner'),
      this.listCommercialMaster(companyId, 'sourceChannel'),
      this.listCommercialMaster(companyId, 'lostReason'),
      this.listCommercialMaster(companyId, 'stage'),
      this.listPriceLists(companyId),
      this.listTemplates(companyId),
    ]);

    return {
      salesOwners,
      sourceChannels,
      lostReasons,
      stages,
      priceLists,
      templates,
    };
  }

  async createCommercialMaster(companyId: string, kind: CommercialMasterKind, dto: CreateCommercialMasterDto) {
    const table = this.masterTableMap[kind];
    const id = randomUUID();
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');

    await this.ensureUniqueCommercialMaster(companyId, table, name);

    if (kind === 'stage' && dto.isDefault) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "isDefault" = false WHERE "companyId" = $1`,
        companyId,
      );
    }

    if (kind === 'salesOwner') {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "${table}" (
            "id", "companyId", "name", "description", "email", "phone", "isActive", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
        `,
        id,
        companyId,
        name,
        this.normalizeOptional(dto.description),
        this.normalizeOptional(dto.email),
        this.normalizeOptional(dto.phone),
      );
    } else if (kind === 'stage') {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "${table}" (
            "id", "companyId", "name", "code", "color", "position", "isDefault", "isClosed", "isActive", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
        `,
        id,
        companyId,
        name,
        this.normalizeOptional(dto.code),
        this.normalizeOptional(dto.color),
        Number(dto.position ?? 0),
        Boolean(dto.isDefault),
        Boolean(dto.isClosed),
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "${table}" (
            "id", "companyId", "name", "description", "isActive", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, true, NOW(), NOW())
        `,
        id,
        companyId,
        name,
        this.normalizeOptional(dto.description),
      );
    }

    return this.listCommercialMaster(companyId, kind);
  }

  async updateCommercialMaster(companyId: string, kind: CommercialMasterKind, id: string, dto: UpdateCommercialMasterDto) {
    const table = this.masterTableMap[kind];
    const current = await this.getCommercialMasterById(companyId, table, id);
    if (!current) throw new NotFoundException('Registro comercial no encontrado');

    const nextName = dto.name?.trim() ?? current.name;
    if (!nextName) throw new BadRequestException('El nombre es obligatorio');
    if (nextName.toLowerCase() !== current.name.toLowerCase()) {
      await this.ensureUniqueCommercialMaster(companyId, table, nextName, id);
    }

    if (kind === 'stage' && dto.isDefault) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "isDefault" = false WHERE "companyId" = $1 AND "id" <> $2`,
        companyId,
        id,
      );
    }

    if (kind === 'salesOwner') {
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "${table}"
          SET
            "name" = $3,
            "description" = $4,
            "email" = $5,
            "phone" = $6,
            "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        id,
        nextName,
        dto.description !== undefined ? this.normalizeOptional(dto.description) : current.description,
        dto.email !== undefined ? this.normalizeOptional(dto.email) : (current.email ?? null),
        dto.phone !== undefined ? this.normalizeOptional(dto.phone) : (current.phone ?? null),
      );
    } else if (kind === 'stage') {
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "${table}"
          SET
            "name" = $3,
            "code" = $4,
            "color" = $5,
            "position" = $6,
            "isDefault" = $7,
            "isClosed" = $8,
            "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        id,
        nextName,
        dto.code !== undefined ? this.normalizeOptional(dto.code) : (current.code ?? null),
        dto.color !== undefined ? this.normalizeOptional(dto.color) : (current.color ?? null),
        Number(dto.position ?? current.position ?? 0),
        dto.isDefault !== undefined ? Boolean(dto.isDefault) : Boolean(current.isDefault),
        dto.isClosed !== undefined ? Boolean(dto.isClosed) : Boolean(current.isClosed),
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "${table}"
          SET
            "name" = $3,
            "description" = $4,
            "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        id,
        nextName,
        dto.description !== undefined ? this.normalizeOptional(dto.description) : current.description,
      );
    }

    return this.listCommercialMaster(companyId, kind);
  }

  async removeCommercialMaster(companyId: string, kind: CommercialMasterKind, id: string) {
    const table = this.masterTableMap[kind];
    const current = await this.getCommercialMasterById(companyId, table, id);
    if (!current) throw new NotFoundException('Registro comercial no encontrado');

    await this.prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "isActive" = false, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );

    return this.listCommercialMaster(companyId, kind);
  }

  async createPriceList(companyId: string, dto: CreateQuotePriceListDto) {
    const id = randomUUID();
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre de la lista es obligatorio');
    await this.ensureUniqueNamedRecord(companyId, 'quote_price_lists', name);

    if (dto.isDefault) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "quote_price_lists" SET "isDefault" = false WHERE "companyId" = $1`,
        companyId,
      );
    }

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_price_lists" (
          "id", "companyId", "name", "description", "currency", "isDefault", "isActive", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
      `,
      id,
      companyId,
      name,
      this.normalizeOptional(dto.description),
      dto.currency?.trim() || 'COP',
      Boolean(dto.isDefault),
    );

    await this.replacePriceListItems(id, dto.items);
    return this.listPriceLists(companyId);
  }

  async updatePriceList(companyId: string, id: string, dto: UpdateQuotePriceListDto) {
    const current = await this.getPriceListById(companyId, id);
    if (!current) throw new NotFoundException('Lista de precios no encontrada');
    const name = dto.name?.trim() ?? current.name;
    if (name.toLowerCase() !== current.name.toLowerCase()) {
      await this.ensureUniqueNamedRecord(companyId, 'quote_price_lists', name, id);
    }
    if (dto.isDefault) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "quote_price_lists" SET "isDefault" = false WHERE "companyId" = $1 AND "id" <> $2`,
        companyId,
        id,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quote_price_lists"
        SET
          "name" = $3,
          "description" = $4,
          "currency" = $5,
          "isDefault" = $6,
          "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      name,
      dto.description !== undefined ? this.normalizeOptional(dto.description) : current.description,
      dto.currency?.trim() || current.currency,
      dto.isDefault !== undefined ? Boolean(dto.isDefault) : current.isDefault,
    );
    if (dto.items) {
      await this.replacePriceListItems(id, dto.items);
    }
    return this.listPriceLists(companyId);
  }

  async removePriceList(companyId: string, id: string) {
    const current = await this.getPriceListById(companyId, id);
    if (!current) throw new NotFoundException('Lista de precios no encontrada');
    await this.prisma.$executeRawUnsafe(
      `UPDATE "quote_price_lists" SET "isActive" = false, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );
    return this.listPriceLists(companyId);
  }

  async createTemplate(companyId: string, dto: CreateQuoteTemplateDto) {
    const id = randomUUID();
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre de la plantilla es obligatorio');
    await this.ensureUniqueNamedRecord(companyId, 'quote_templates', name);

    if (dto.isDefault) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "quote_templates" SET "isDefault" = false WHERE "companyId" = $1`,
        companyId,
      );
    }

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_templates" (
          "id", "companyId", "name", "description", "notes", "terms", "currency", "isDefault", "isActive", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
      `,
      id,
      companyId,
      name,
      this.normalizeOptional(dto.description),
      this.normalizeOptional(dto.notes),
      this.normalizeOptional(dto.terms),
      dto.currency?.trim() || 'COP',
      Boolean(dto.isDefault),
    );

    await this.replaceTemplateItems(id, dto.items);
    return this.listTemplates(companyId);
  }

  async updateTemplate(companyId: string, id: string, dto: UpdateQuoteTemplateDto) {
    const current = await this.getTemplateById(companyId, id);
    if (!current) throw new NotFoundException('Plantilla no encontrada');
    const name = dto.name?.trim() ?? current.name;
    if (name.toLowerCase() !== current.name.toLowerCase()) {
      await this.ensureUniqueNamedRecord(companyId, 'quote_templates', name, id);
    }
    if (dto.isDefault) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "quote_templates" SET "isDefault" = false WHERE "companyId" = $1 AND "id" <> $2`,
        companyId,
        id,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quote_templates"
        SET
          "name" = $3,
          "description" = $4,
          "notes" = $5,
          "terms" = $6,
          "currency" = $7,
          "isDefault" = $8,
          "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      name,
      dto.description !== undefined ? this.normalizeOptional(dto.description) : current.description,
      dto.notes !== undefined ? this.normalizeOptional(dto.notes) : current.notes,
      dto.terms !== undefined ? this.normalizeOptional(dto.terms) : current.terms,
      dto.currency?.trim() || current.currency,
      dto.isDefault !== undefined ? Boolean(dto.isDefault) : current.isDefault,
    );
    if (dto.items) {
      await this.replaceTemplateItems(id, dto.items);
    }
    return this.listTemplates(companyId);
  }

  async removeTemplate(companyId: string, id: string) {
    const current = await this.getTemplateById(companyId, id);
    if (!current) throw new NotFoundException('Plantilla no encontrada');
    await this.prisma.$executeRawUnsafe(
      `UPDATE "quote_templates" SET "isActive" = false, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );
    return this.listTemplates(companyId);
  }

  async getApprovalPolicies(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<QuoteApprovalPolicyRow[]>(
      `
        SELECT *
        FROM "quote_approval_policies"
        WHERE "companyId" = $1 AND "isActive" = true
        ORDER BY "sequence" ASC, "approvalType" ASC, "thresholdValue" ASC, "name" ASC
      `,
      companyId,
    );
    return rows.map((row) => ({
      ...row,
      thresholdValue: Number(row.thresholdValue ?? 0),
      sequence: Number(row.sequence ?? 1),
      isActive: Boolean(row.isActive),
    }));
  }

  async createApprovalPolicy(companyId: string, dto: CreateQuoteApprovalPolicyDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre de la política es obligatorio');
    await this.ensureUniqueNamedRecord(companyId, 'quote_approval_policies', name);

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_approval_policies" (
          "id", "companyId", "name", "approvalType", "thresholdValue", "requiredRole", "sequence", "description", "isActive", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
      `,
      randomUUID(),
      companyId,
      name,
      dto.approvalType,
      Number(dto.thresholdValue ?? 0),
      dto.requiredRole?.trim() || 'MANAGER',
      Number(dto.sequence ?? 1),
      this.normalizeOptional(dto.description),
    );

    return this.getApprovalPolicies(companyId);
  }

  async updateApprovalPolicy(companyId: string, id: string, dto: UpdateQuoteApprovalPolicyDto) {
    const current = await this.getApprovalPolicyById(companyId, id);
    if (!current) throw new NotFoundException('Política de aprobación no encontrada');
    const nextName = dto.name?.trim() ?? current.name;
    if (nextName.toLowerCase() !== current.name.toLowerCase()) {
      await this.ensureUniqueNamedRecord(companyId, 'quote_approval_policies', nextName, id);
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quote_approval_policies"
        SET
          "name" = $3,
          "approvalType" = $4,
          "thresholdValue" = $5,
          "requiredRole" = $6,
          "sequence" = $7,
          "description" = $8,
          "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      nextName,
      dto.approvalType ?? current.approvalType,
      Number(dto.thresholdValue ?? current.thresholdValue ?? 0),
      dto.requiredRole?.trim() || current.requiredRole,
      Number(dto.sequence ?? current.sequence ?? 1),
      dto.description !== undefined ? this.normalizeOptional(dto.description) : current.description,
    );

    return this.getApprovalPolicies(companyId);
  }

  async removeApprovalPolicy(companyId: string, id: string) {
    const current = await this.getApprovalPolicyById(companyId, id);
    if (!current) throw new NotFoundException('Política de aprobación no encontrada');
    await this.prisma.$executeRawUnsafe(
      `UPDATE "quote_approval_policies" SET "isActive" = false, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );
    return this.getApprovalPolicies(companyId);
  }

  private normalizeOptional(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private async getApprovalPolicyById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<QuoteApprovalPolicyRow[]>(
      `SELECT * FROM "quote_approval_policies" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
      companyId,
      id,
    );
    return rows[0] ?? null;
  }

  private async listCommercialMaster(companyId: string, kind: CommercialMasterKind) {
    const table = this.masterTableMap[kind];
    const rows = await this.prisma.$queryRawUnsafe<CommercialMasterRow[]>(
      `
        SELECT *
        FROM "${table}"
        WHERE "companyId" = $1 AND "isActive" = true
        ORDER BY ${kind === 'stage' ? '"position" ASC,' : ''} "name" ASC
      `,
      companyId,
    );
    return rows.map((row) => ({
      ...row,
      position: Number(row.position ?? 0),
      isDefault: Boolean(row.isDefault ?? false),
      isClosed: Boolean(row.isClosed ?? false),
      isActive: Boolean(row.isActive),
    }));
  }

  private async getCommercialMasterById(companyId: string, table: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<CommercialMasterRow[]>(
      `SELECT * FROM "${table}" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
      companyId,
      id,
    );
    return rows[0] ?? null;
  }

  private async ensureUniqueCommercialMaster(companyId: string, table: string, name: string, excludeId?: string) {
    await this.ensureUniqueNamedRecord(companyId, table, name, excludeId);
  }

  private async ensureUniqueNamedRecord(companyId: string, table: string, name: string, excludeId?: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM "${table}"
        WHERE "companyId" = $1
          AND LOWER("name") = LOWER($2)
          ${excludeId ? 'AND "id" <> $3' : ''}
        LIMIT 1
      `,
      ...(excludeId ? [companyId, name, excludeId] : [companyId, name]),
    );
    if (rows.length) {
      throw new ConflictException('Ya existe un registro con ese nombre');
    }
  }

  private async listPriceLists(companyId: string) {
    const [lists, items] = await Promise.all([
      this.prisma.$queryRawUnsafe<PriceListRow[]>(
        `
          SELECT *
          FROM "quote_price_lists"
          WHERE "companyId" = $1 AND "isActive" = true
          ORDER BY "isDefault" DESC, "name" ASC
        `,
        companyId,
      ),
      this.prisma.$queryRawUnsafe<PriceListItemRow[]>(
        `
          SELECT pli.*
          FROM "quote_price_list_items" pli
          INNER JOIN "quote_price_lists" pl ON pl."id" = pli."priceListId"
          WHERE pl."companyId" = $1 AND pl."isActive" = true
          ORDER BY pli."position" ASC, pli."createdAt" ASC
        `,
        companyId,
      ),
    ]);
    const itemsByList = new Map<string, PriceListItemRow[]>();
    items.forEach((item) => {
      const bucket = itemsByList.get(item.priceListId) ?? [];
      bucket.push(item);
      itemsByList.set(item.priceListId, bucket);
    });
    return lists.map((list) => ({
      ...list,
      items: (itemsByList.get(list.id) ?? []).map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
        taxRate: Number(item.taxRate ?? 19),
      })),
    }));
  }

  private async getPriceListById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<PriceListRow[]>(
      `SELECT * FROM "quote_price_lists" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
      companyId,
      id,
    );
    return rows[0] ?? null;
  }

  private async replacePriceListItems(priceListId: string, items: CreateQuotePriceListDto['items']) {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "quote_price_list_items" WHERE "priceListId" = $1`,
      priceListId,
    );
    for (const [index, item] of items.entries()) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "quote_price_list_items" (
            "id", "priceListId", "productId", "description", "unitPrice", "taxRate", "position", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        `,
        randomUUID(),
        priceListId,
        item.productId ?? null,
        item.description?.trim() || 'Item comercial',
        Number(item.unitPrice ?? 0),
        Number(item.taxRate ?? 19),
        Number(item.position ?? index + 1),
      );
    }
  }

  private async listTemplates(companyId: string) {
    const [templates, items] = await Promise.all([
      this.prisma.$queryRawUnsafe<TemplateRow[]>(
        `
          SELECT *
          FROM "quote_templates"
          WHERE "companyId" = $1 AND "isActive" = true
          ORDER BY "isDefault" DESC, "name" ASC
        `,
        companyId,
      ),
      this.prisma.$queryRawUnsafe<TemplateItemRow[]>(
        `
          SELECT ti.*
          FROM "quote_template_items" ti
          INNER JOIN "quote_templates" qt ON qt."id" = ti."templateId"
          WHERE qt."companyId" = $1 AND qt."isActive" = true
          ORDER BY ti."position" ASC, ti."createdAt" ASC
        `,
        companyId,
      ),
    ]);
    const itemsByTemplate = new Map<string, TemplateItemRow[]>();
    items.forEach((item) => {
      const bucket = itemsByTemplate.get(item.templateId) ?? [];
      bucket.push(item);
      itemsByTemplate.set(item.templateId, bucket);
    });
    return templates.map((template) => ({
      ...template,
      items: (itemsByTemplate.get(template.id) ?? []).map((item) => ({
        ...item,
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
        taxRate: Number(item.taxRate ?? 19),
        discount: Number(item.discount ?? 0),
      })),
    }));
  }

  private async getTemplateById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<TemplateRow[]>(
      `SELECT * FROM "quote_templates" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
      companyId,
      id,
    );
    return rows[0] ?? null;
  }

  private async getAdvancedCommercialFields(companyId: string, quoteIds: string[]) {
    if (!quoteIds.length) return new Map<string, QuoteAdvancedCommercialRow>();
    const rows = await this.prisma.$queryRawUnsafe<QuoteAdvancedCommercialRow[]>(
      `
        SELECT
          "id",
          "paymentTermLabel",
          "paymentTermDays",
          "deliveryLeadTimeDays",
          "deliveryTerms",
          "incotermCode",
          "incotermLocation",
          "exchangeRate",
          "commercialConditions"
        FROM "quotes"
        WHERE "companyId" = $1
          AND "id" = ANY($2)
      `,
      companyId,
      quoteIds,
    );
    return new Map(rows.map((row) => [row.id, {
      ...row,
      paymentTermDays: row.paymentTermDays !== null && row.paymentTermDays !== undefined ? Number(row.paymentTermDays) : null,
      deliveryLeadTimeDays: row.deliveryLeadTimeDays !== null && row.deliveryLeadTimeDays !== undefined ? Number(row.deliveryLeadTimeDays) : null,
      exchangeRate: Number(row.exchangeRate ?? 1),
    }]));
  }

  private async persistAdvancedCommercialFields(companyId: string, quoteId: string, dto: Partial<CreateQuoteDto>) {
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quotes"
        SET
          "paymentTermLabel" = $3,
          "paymentTermDays" = $4,
          "deliveryLeadTimeDays" = $5,
          "deliveryTerms" = $6,
          "incotermCode" = $7,
          "incotermLocation" = $8,
          "exchangeRate" = $9,
          "commercialConditions" = $10,
          "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      quoteId,
      this.normalizeOptional(dto.paymentTermLabel),
      dto.paymentTermDays !== undefined ? Number(dto.paymentTermDays) : null,
      dto.deliveryLeadTimeDays !== undefined ? Number(dto.deliveryLeadTimeDays) : null,
      this.normalizeOptional(dto.deliveryTerms),
      this.normalizeOptional(dto.incotermCode),
      this.normalizeOptional(dto.incotermLocation),
      Number(dto.exchangeRate ?? 1),
      this.normalizeOptional(dto.commercialConditions),
    );
  }

  private async replaceTemplateItems(templateId: string, items: CreateQuoteTemplateDto['items']) {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "quote_template_items" WHERE "templateId" = $1`,
      templateId,
    );
    for (const [index, item] of items.entries()) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "quote_template_items" (
            "id", "templateId", "productId", "description", "quantity", "unitPrice", "taxRate", "discount", "position", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        `,
        randomUUID(),
        templateId,
        item.productId ?? null,
        item.description?.trim() || 'Item de plantilla',
        Number(item.quantity ?? 1),
        Number(item.unitPrice ?? 0),
        Number(item.taxRate ?? 19),
        Number(item.discount ?? 0),
        Number(item.position ?? index + 1),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Genera el siguiente número de cotización para la empresa
  // Formato: COT-{NNNN} (ej: COT-0001, COT-0042)
  // ─────────────────────────────────────────────────────────────────────────────
  private async getNextQuoteNumber(companyId: string): Promise<string> {
    const last = await this.prisma.quote.findFirst({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    if (!last) return 'COT-0001';

    // Extrae el número del formato COT-NNNN y suma 1
    const parts = last.number.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0', 10) + 1;
    return `COT-${String(num).padStart(4, '0')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Genera el siguiente número de factura para conversión
  // Formato: FV-{NNNN} — busca el último número con prefix='FV' de la empresa
  // ─────────────────────────────────────────────────────────────────────────────
  private async getNextInvoiceNumber(companyId: string, prefix: string): Promise<string> {
    const last = await this.prisma.invoice.findFirst({
      where: { companyId, prefix, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    if (!last) return `${prefix}-0001`;

    // Extrae el número del formato PREFIX-NNNN y suma 1
    const parts = last.invoiceNumber.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0', 10) + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Calcula los totales de los ítems de la cotización
  // lineTotal  = quantity * unitPrice * (1 - discount/100)
  // lineTax    = lineTotal * taxRate / 100
  // subtotal   = sum(lineTotal)
  // taxAmount  = sum(lineTax)
  // total      = subtotal + taxAmount - discountAmount
  // ─────────────────────────────────────────────────────────────────────────────
  private calculateTotals(
    items: CreateQuoteDto['items'],
    discountAmount = 0,
  ): {
    itemsWithTotals: any[];
    subtotal: number;
    taxAmount: number;
    total: number;
  } {
    let subtotal = 0;
    let taxAmount = 0;

    const itemsWithTotals = items.map((item, index) => {
      const qty = Number(item.quantity);
      const price = Number(item.unitPrice);
      const discount = Number(item.discount ?? 0);
      const taxRate = Number(item.taxRate ?? 19);

      // Total neto de la línea después de descuento
      const lineTotal = qty * price * (1 - discount / 100);
      // Impuesto de la línea
      const lineTax = lineTotal * (taxRate / 100);

      subtotal += lineTotal;
      taxAmount += lineTax;

      return {
        description: item.description,
        quantity: qty,
        unitPrice: price,
        taxRate: taxRate,
        taxAmount: lineTax,
        discount: discount,
        total: lineTotal + lineTax,
        position: item.position ?? index + 1,
        ...(item.productId && { product: { connect: { id: item.productId } } }),
      };
    });

    const total = subtotal + taxAmount - Number(discountAmount);

    return { itemsWithTotals, subtotal, taxAmount, total };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LISTAR cotizaciones con filtros y paginación
  // ─────────────────────────────────────────────────────────────────────────────
  async findAll(
    companyId: string,
    filters: {
      search?: string;
      status?: string;
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    await this.expireDueQuotes(companyId);
    const { search, status, customerId, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = { companyId, deletedAt: null };

    // Filtro por búsqueda en número de cotización o nombre de cliente
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    // Filtro por rango de fechas de emisión
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          items: { select: { discount: true } },
          _count: { select: { items: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take: +limit,
      }),
      this.prisma.quote.count({ where }),
    ]);

    const enriched = await this.attachCommercialMetadata(companyId, data);
    return { data: enriched, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }

  async getAnalyticsSummary(
    companyId: string,
    filters: {
      dateFrom?: string;
      dateTo?: string;
      salesOwnerName?: string;
      sourceChannel?: string;
    },
  ) {
    const { dateFrom, dateTo, salesOwnerName, sourceChannel } = filters;
    const where: any = { companyId, deletedAt: null };

    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }
    if (salesOwnerName) {
      where.salesOwnerName = { contains: salesOwnerName, mode: 'insensitive' };
    }
    if (sourceChannel) {
      where.sourceChannel = { contains: sourceChannel, mode: 'insensitive' };
    }

    const [quotes, pendingApprovals, followUps] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        select: {
          id: true,
          status: true,
          total: true,
          salesOwnerName: true,
          sourceChannel: true,
          customerId: true,
        },
      }),
      this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
        `
          SELECT COUNT(DISTINCT qar."quoteId") AS "total"
          FROM "quote_approval_requests" qar
          INNER JOIN "quotes" q ON q."id" = qar."quoteId"
          WHERE qar."companyId" = $1
            AND q."deletedAt" IS NULL
            AND qar."status" = 'PENDING'
            ${dateFrom ? 'AND q."issueDate" >= $2' : ''}
            ${dateTo ? `AND q."issueDate" <= $${dateFrom ? 3 : 2}` : ''}
        `,
        ...(dateFrom && dateTo
          ? [companyId, new Date(dateFrom), new Date(dateTo)]
          : dateFrom
            ? [companyId, new Date(dateFrom)]
            : dateTo
              ? [companyId, new Date(dateTo)]
              : [companyId]),
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
        `
          SELECT COUNT(*) AS "total"
          FROM "quote_followups" qf
          INNER JOIN "quotes" q ON q."id" = qf."quoteId"
          WHERE qf."companyId" = $1
            AND q."deletedAt" IS NULL
            ${dateFrom ? 'AND q."issueDate" >= $2' : ''}
            ${dateTo ? `AND q."issueDate" <= $${dateFrom ? 3 : 2}` : ''}
        `,
        ...(dateFrom && dateTo
          ? [companyId, new Date(dateFrom), new Date(dateTo)]
          : dateFrom
            ? [companyId, new Date(dateFrom)]
            : dateTo
              ? [companyId, new Date(dateTo)]
              : [companyId]),
      ),
    ]);

    const totalsByStatus = quotes.reduce((acc, quote) => {
      acc[quote.status] = (acc[quote.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalAmount = quotes.reduce((sum, quote) => sum + Number(quote.total ?? 0), 0);
    const convertedAmount = quotes
      .filter((quote) => quote.status === 'CONVERTED')
      .reduce((sum, quote) => sum + Number(quote.total ?? 0), 0);
    const acceptedAmount = quotes
      .filter((quote) => quote.status === 'ACCEPTED')
      .reduce((sum, quote) => sum + Number(quote.total ?? 0), 0);

    const totalQuotes = quotes.length;
    const wonQuotes = (totalsByStatus['CONVERTED'] ?? 0) + (totalsByStatus['ACCEPTED'] ?? 0);
    const lostQuotes = (totalsByStatus['REJECTED'] ?? 0) + (totalsByStatus['EXPIRED'] ?? 0);

    const bySalesOwner = Object.entries(
      quotes.reduce((acc, quote) => {
        const key = quote.salesOwnerName?.trim() || 'Sin asignar';
        const bucket = acc[key] ?? { name: key, totalQuotes: 0, totalAmount: 0, wonQuotes: 0 };
        bucket.totalQuotes += 1;
        bucket.totalAmount += Number(quote.total ?? 0);
        if (quote.status === 'ACCEPTED' || quote.status === 'CONVERTED') bucket.wonQuotes += 1;
        acc[key] = bucket;
        return acc;
      }, {} as Record<string, { name: string; totalQuotes: number; totalAmount: number; wonQuotes: number }>),
    )
      .map(([, bucket]) => ({
        ...bucket,
        winRate: bucket.totalQuotes ? Math.round((bucket.wonQuotes / bucket.totalQuotes) * 100) : 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    const byChannel = Object.entries(
      quotes.reduce((acc, quote) => {
        const key = quote.sourceChannel?.trim() || 'Sin canal';
        const bucket = acc[key] ?? { channel: key, totalQuotes: 0, totalAmount: 0 };
        bucket.totalQuotes += 1;
        bucket.totalAmount += Number(quote.total ?? 0);
        acc[key] = bucket;
        return acc;
      }, {} as Record<string, { channel: string; totalQuotes: number; totalAmount: number }>),
    )
      .map(([, bucket]) => bucket)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    return {
      totalQuotes,
      totalAmount,
      convertedAmount,
      acceptedAmount,
      wonQuotes,
      lostQuotes,
      conversionRate: totalQuotes ? Math.round(((totalsByStatus['CONVERTED'] ?? 0) / totalQuotes) * 100) : 0,
      winRate: totalQuotes ? Math.round((wonQuotes / totalQuotes) * 100) : 0,
      lossRate: totalQuotes ? Math.round((lostQuotes / totalQuotes) * 100) : 0,
      pendingApprovals: Number(pendingApprovals[0]?.total ?? 0),
      followUpCount: Number(followUps[0]?.total ?? 0),
      totalsByStatus,
      bySalesOwner,
      byChannel,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DETALLE de cotización con ítems, cliente e invoice asociada (si fue convertida)
  // ─────────────────────────────────────────────────────────────────────────────
  async findOne(companyId: string, id: string) {
    await this.expireDueQuotes(companyId);
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: true,
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
          orderBy: { position: 'asc' },
        },
        // Incluye la factura si la cotización fue convertida
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            issueDate: true,
          },
        },
      },
    });

    if (!quote) throw new NotFoundException('Cotización no encontrada');
    const [approval, approvalFlow, versionCount, advancedFieldsMap] = await Promise.all([
      this.getLatestApproval(companyId, id),
      this.getApprovalFlow(companyId, id),
      this.getCurrentVersionNumber(companyId, id),
      this.getAdvancedCommercialFields(companyId, [id]),
    ]);
    const advancedFields = advancedFieldsMap.get(id);
    return this.normalizeQuoteSelections({
      ...quote,
      ...(advancedFields ?? {}),
      approval,
      approvalFlow,
      approvalRequired: await this.requiresApproval(companyId, Number(quote.total), quote.items as any[]),
      currentVersion: versionCount,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CREAR cotización — genera número automático y calcula totales
  // ─────────────────────────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateQuoteDto, userId?: string) {
    // Validar que el cliente existe y pertenece a la empresa
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    await this.ensureCommercialSelectionsBelongToCompany(companyId, dto.priceListId, dto.templateId);

    const number = await this.getNextQuoteNumber(companyId);
    const { itemsWithTotals, subtotal, taxAmount, total } = this.calculateTotals(
      dto.items,
      dto.discountAmount ?? 0,
    );

    const created = await this.prisma.quote.create({
      data: {
        companyId,
        customerId: dto.customerId,
        selectedPriceListId: dto.priceListId ?? null,
        selectedTemplateId: dto.templateId ?? null,
        number,
        status: 'DRAFT',
        issueDate: new Date(dto.issueDate),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        subtotal,
        taxAmount,
        discountAmount: dto.discountAmount ?? 0,
        total,
        notes: dto.notes,
        terms: dto.terms,
        salesOwnerName: dto.salesOwnerName,
        opportunityName: dto.opportunityName,
        sourceChannel: dto.sourceChannel,
        currency: dto.currency ?? 'COP',
        items: { create: itemsWithTotals },
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        items: { orderBy: { position: 'asc' } },
      },
    });
    await this.persistAdvancedCommercialFields(companyId, created.id, dto);
    const advancedFields = (await this.getAdvancedCommercialFields(companyId, [created.id])).get(created.id);
    await this.createVersionSnapshot(companyId, created.id, 'CREATE', { ...created, ...(advancedFields ?? {}) }, userId ?? null);
    await this.logQuoteAudit(companyId, created.id, 'QUOTE_CREATED', userId ?? null, null, {
      number: created.number,
      status: created.status,
      total: Number(created.total ?? 0),
      customerId: created.customerId,
    });
    return this.normalizeQuoteSelections({
      ...created,
      ...(advancedFields ?? {}),
      approvalRequired: await this.requiresApproval(companyId, total, dto.items),
      currentVersion: 1,
      approvalFlow: [],
      approval: null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ACTUALIZAR cotización — solo permite modificar estados DRAFT o SENT
  // ─────────────────────────────────────────────────────────────────────────────
  async update(companyId: string, id: string, dto: UpdateQuoteDto, userId?: string) {
    const quote = await this.findOne(companyId, id);
    await this.ensureCommercialSelectionsBelongToCompany(companyId, dto.priceListId, dto.templateId);

    if (!MUTABLE_STATUSES.includes(quote.status as QuoteStatus)) {
      throw new BadRequestException(
        `Solo se pueden modificar cotizaciones en estado DRAFT o SENT. Estado actual: ${quote.status}`,
      );
    }

    // Si se actualizan ítems, recalcular totales y reemplazar los ítems existentes
    let totalsData: Partial<{
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      total: number;
    }> = {};
    let itemsOperation: any = {};

    if (dto.items && dto.items.length > 0) {
      const { itemsWithTotals, subtotal, taxAmount, total } = this.calculateTotals(
        dto.items,
        dto.discountAmount ?? Number(quote.discountAmount) ?? 0,
      );
      totalsData = { subtotal, taxAmount, total };

      // Eliminar ítems existentes y crear los nuevos
      itemsOperation = {
        items: {
          deleteMany: { quoteId: id },
          create: itemsWithTotals,
        },
      };
    } else if (dto.discountAmount !== undefined) {
      // Recalcular solo el total si cambió el descuento global sin nuevos ítems
      const currentSubtotal = Number(quote.subtotal);
      const currentTax = Number(quote.taxAmount);
      totalsData = {
        discountAmount: dto.discountAmount,
        total: currentSubtotal + currentTax - dto.discountAmount,
      };
    }

    // Excluir 'items' del spread del dto para no pasarlo directamente a Prisma
    const { items, priceListId, templateId, ...dtoWithoutItems } = dto;

    await this.ensureQuoteCanProceed(companyId, id, quote);
    await this.createVersionSnapshot(companyId, id, 'UPDATE_BEFORE', quote, userId ?? null);

    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        ...dtoWithoutItems,
        ...(priceListId !== undefined ? { selectedPriceListId: priceListId || null } : {}),
        ...(templateId !== undefined ? { selectedTemplateId: templateId || null } : {}),
        ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
        ...(dto.expiresAt && { expiresAt: new Date(dto.expiresAt) }),
        ...totalsData,
        ...itemsOperation,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        items: { orderBy: { position: 'asc' } },
      },
    });
    await this.persistAdvancedCommercialFields(companyId, id, {
      paymentTermLabel: dto.paymentTermLabel !== undefined ? dto.paymentTermLabel : (quote as any).paymentTermLabel,
      paymentTermDays: dto.paymentTermDays !== undefined ? dto.paymentTermDays : (quote as any).paymentTermDays,
      deliveryLeadTimeDays: dto.deliveryLeadTimeDays !== undefined ? dto.deliveryLeadTimeDays : (quote as any).deliveryLeadTimeDays,
      deliveryTerms: dto.deliveryTerms !== undefined ? dto.deliveryTerms : (quote as any).deliveryTerms,
      incotermCode: dto.incotermCode !== undefined ? dto.incotermCode : (quote as any).incotermCode,
      incotermLocation: dto.incotermLocation !== undefined ? dto.incotermLocation : (quote as any).incotermLocation,
      exchangeRate: dto.exchangeRate !== undefined ? dto.exchangeRate : (quote as any).exchangeRate,
      commercialConditions: dto.commercialConditions !== undefined ? dto.commercialConditions : (quote as any).commercialConditions,
    });
    await this.supersedeApprovalFlow(companyId, id);
    const advancedFields = (await this.getAdvancedCommercialFields(companyId, [id])).get(id);
    await this.logQuoteAudit(companyId, id, 'QUOTE_UPDATED', userId ?? null, {
      status: quote.status,
      total: Number(quote.total ?? 0),
      currentVersion: quote.currentVersion,
    }, {
      status: updated.status,
      total: Number(updated.total ?? 0),
      currentVersion: await this.getCurrentVersionNumber(companyId, id),
    });
    return this.normalizeQuoteSelections({
      ...updated,
      ...(advancedFields ?? {}),
      approvalRequired: await this.requiresApproval(companyId, Number(updated.total), updated.items as any[]),
      currentVersion: await this.getCurrentVersionNumber(companyId, id),
      approval: await this.getLatestApproval(companyId, id),
      approvalFlow: await this.getApprovalFlow(companyId, id),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CAMBIAR ESTADO — no permite asignar CONVERTED manualmente.
  // Cuando pasa a SENT, genera PDF y envía email al cliente si tiene email.
  // ─────────────────────────────────────────────────────────────────────────────
  async updateStatus(companyId: string, id: string, status: QuoteStatus, userId?: string, lostReason?: string) {
    const quote = await this.findOne(companyId, id);

    // CONVERTED solo se puede asignar mediante el endpoint de conversión
    if (status === 'CONVERTED') {
      throw new BadRequestException(
        'El estado CONVERTED no puede asignarse manualmente. Use el endpoint /convert.',
      );
    }

    if (['SENT', 'ACCEPTED'].includes(status)) {
      await this.ensureQuoteCanProceed(companyId, id, quote);
    }

    if (status === 'REJECTED' && !lostReason?.trim() && !quote.lostReason) {
      throw new BadRequestException('Debes registrar el motivo de pérdida al rechazar la cotización');
    }

    await this.createVersionSnapshot(companyId, id, 'STATUS_CHANGE', quote, userId ?? null);

    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        status,
        ...(status === 'REJECTED' ? { lostReason: lostReason?.trim() || quote.lostReason || null } : {}),
      },
    });

    // Enviar email con PDF cuando el estado pasa a SENT
    if (status === 'SENT') {
      const customerEmail = (quote.customer as any)?.email;
      if (customerEmail) {
        try {
          const pdfBuffer = await this.generatePdf(companyId, id);
          await this.mailer.sendQuoteEmail(
            customerEmail,
            quote.number,
            (quote.customer as any)?.name ?? 'Cliente',
            pdfBuffer,
          );
          this.logger.log(`Email enviado para cotización ${quote.number} a ${customerEmail}`);
        } catch (err) {
          this.logger.error(
            `Error al enviar email para cotización ${quote.number}: ${(err as Error).message}`,
          );
          // No fallar el flujo principal por error de email
        }
      }
    }

    await this.logQuoteAudit(companyId, id, 'QUOTE_STATUS_UPDATED', userId ?? null, {
      status: quote.status,
      lostReason: quote.lostReason ?? null,
    }, {
      status,
      lostReason: status === 'REJECTED' ? (lostReason?.trim() || quote.lostReason || null) : quote.lostReason ?? null,
    });

    return {
      ...updated,
      approvalRequired: await this.requiresApproval(companyId, Number(updated.total), quote.items as any[]),
      currentVersion: await this.getCurrentVersionNumber(companyId, id),
      approval: await this.getLatestApproval(companyId, id),
      approvalFlow: await this.getApprovalFlow(companyId, id),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERTIR cotización a factura
  // - Crea una Invoice tipo VENTA con los mismos ítems
  // - Asigna Quote.invoiceId = invoice.id y Quote.status = CONVERTED
  // - Lanza ConflictException si la cotización ya fue convertida
  // ─────────────────────────────────────────────────────────────────────────────
  async convertToInvoice(companyId: string, id: string, userId?: string) {
    const quote = await this.findOne(companyId, id);
    await this.ensureQuoteCanProceed(companyId, id, quote);

    // Verificar que no haya sido convertida previamente
    if (quote.invoiceId) {
      throw new ConflictException(
        `La cotización ya fue convertida a la factura ${quote.invoice?.invoiceNumber ?? quote.invoiceId}`,
      );
    }

    if (quote.status === 'CONVERTED') {
      throw new ConflictException('Esta cotización ya fue convertida a factura.');
    }

    // Construir ítems para la factura copiando desde los ítems de la cotización
    const invoiceItems = (quote.items as any[]).map((item: any) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxRate: Number(item.taxRate),
      taxAmount: Number(item.taxAmount),
      discount: Number(item.discount),
      total: Number(item.total),
      position: item.position,
      ...(item.productId && { product: { connect: { id: item.productId } } }),
    }));

    const invoiceNumber = await this.getNextInvoiceNumber(companyId, 'FV');
    const prefix = 'FV';

    // Crear la factura y actualizar la cotización en una transacción atómica
    const [invoice] = await this.prisma.$transaction([
      // 1. Crear la factura con los ítems copiados
      this.prisma.invoice.create({
        data: {
          companyId,
          customerId: quote.customerId,
          invoiceNumber,
          prefix,
          type: 'VENTA',
          status: 'DRAFT',
          issueDate: new Date(),
          subtotal: Number(quote.subtotal),
          taxAmount: Number(quote.taxAmount),
          discountAmount: Number(quote.discountAmount),
          total: Number(quote.total),
          currency: quote.currency,
          notes: quote.notes,
          items: { create: invoiceItems },
        },
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          items: { orderBy: { position: 'asc' } },
        },
      }),
      // 2. Marcar la cotización como CONVERTED (invoiceId se asigna después de crear la invoice)
      // Se actualiza en el paso posterior por necesitar el ID generado
    ]);

    // 3. Asignar el invoiceId y estado CONVERTED a la cotización
    await this.createVersionSnapshot(companyId, id, 'CONVERT', quote, userId ?? null);
    await this.prisma.quote.update({
      where: { id },
      data: {
        invoiceId: invoice.id,
        status: 'CONVERTED',
      },
    });

    await this.logQuoteAudit(companyId, id, 'QUOTE_CONVERTED', userId ?? null, {
      invoiceId: null,
      status: quote.status,
    }, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: 'CONVERTED',
    });

    return invoice;
  }

  async getVersions(companyId: string, id: string) {
    await this.findOne(companyId, id);
    const rows = await this.prisma.$queryRawUnsafe<QuoteVersionRow[]>(
      `
        SELECT "id", "quoteId", "versionNumber", "action", "snapshot", "createdById", "createdAt"
        FROM "quote_versions"
        WHERE "companyId" = $1 AND "quoteId" = $2
        ORDER BY "versionNumber" DESC
      `,
      companyId,
      id,
    );
    return rows;
  }

  async requestApproval(companyId: string, id: string, dto: RequestQuoteApprovalDto, userId: string) {
    const quote = await this.findOne(companyId, id);
    const requiresApproval = await this.requiresApproval(companyId, Number(quote.total), quote.items as any[]);
    if (!requiresApproval) {
      throw new BadRequestException('Esta cotización no requiere aprobación según las reglas actuales');
    }

    const currentFlow = await this.getApprovalFlow(companyId, id);
    if (currentFlow.some((step) => step.status === 'PENDING')) {
      throw new ConflictException('La cotización ya tiene una solicitud de aprobación pendiente');
    }

    if (currentFlow.length) {
      await this.supersedeApprovalFlow(companyId, id);
    }

    await this.createApprovalFlow(
      companyId,
      id,
      dto.reason?.trim() || 'Solicitud de aprobación por política comercial',
      userId,
      Number(quote.total),
      quote.items as any[],
    );

    await this.logQuoteAudit(companyId, id, 'QUOTE_APPROVAL_REQUESTED', userId, null, {
      reason: dto.reason?.trim() || 'Solicitud de aprobación por política comercial',
    });

    return this.findOne(companyId, id);
  }

  async approve(companyId: string, id: string, userId: string) {
    const approvalFlow = await this.getApprovalFlow(companyId, id);
    const approval = approvalFlow.find((step) => step.status === 'PENDING');
    if (!approval) {
      throw new BadRequestException('La cotización no tiene aprobaciones pendientes');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quote_approval_requests"
        SET "status" = 'APPROVED',
            "approvedById" = $3,
            "approvedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      approval.id,
      userId,
    );

    await this.logQuoteAudit(companyId, id, 'QUOTE_APPROVED', userId, {
      approvalId: approval.id,
      status: 'PENDING',
      sequence: approval.sequence,
    }, {
      approvalId: approval.id,
      status: 'APPROVED',
      sequence: approval.sequence,
    });

    return this.findOne(companyId, id);
  }

  async rejectApproval(companyId: string, id: string, dto: RejectQuoteApprovalDto, userId: string) {
    const approvalFlow = await this.getApprovalFlow(companyId, id);
    const approval = approvalFlow.find((step) => step.status === 'PENDING');
    if (!approval) {
      throw new BadRequestException('La cotización no tiene aprobaciones pendientes');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quote_approval_requests"
        SET "status" = 'REJECTED',
            "approvedById" = $3,
            "rejectedAt" = NOW(),
            "rejectedReason" = $4,
            "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      approval.id,
      userId,
      dto.reason?.trim() || 'Rechazada en comité comercial',
    );

    await this.logQuoteAudit(companyId, id, 'QUOTE_APPROVAL_REJECTED', userId, {
      approvalId: approval.id,
      status: 'PENDING',
      sequence: approval.sequence,
    }, {
      approvalId: approval.id,
      status: 'REJECTED',
      sequence: approval.sequence,
      rejectedReason: dto.reason?.trim() || 'Rechazada en comité comercial',
    });

    return this.findOne(companyId, id);
  }

  async expireDueQuotes(companyId: string) {
    const result = await this.prisma.quote.updateMany({
      where: {
        companyId,
        deletedAt: null,
        expiresAt: { lt: new Date() },
        status: { in: ['DRAFT', 'SENT'] },
      },
      data: { status: 'EXPIRED' },
    });
    return { expired: result.count };
  }

  async duplicate(companyId: string, id: string, userId: string) {
    const quote = await this.findOne(companyId, id);
    const duplicated = await this.create(companyId, {
      customerId: quote.customerId,
      issueDate: new Date().toISOString().substring(0, 10),
      expiresAt: quote.expiresAt ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10) : undefined,
      notes: quote.notes ?? undefined,
      terms: quote.terms ?? undefined,
      salesOwnerName: quote.salesOwnerName ?? undefined,
      opportunityName: quote.opportunityName ?? undefined,
      sourceChannel: quote.sourceChannel ?? undefined,
      priceListId: (quote as any).selectedPriceListId ?? (quote as any).priceListId ?? undefined,
      templateId: (quote as any).selectedTemplateId ?? (quote as any).templateId ?? undefined,
      currency: quote.currency ?? undefined,
      paymentTermLabel: (quote as any).paymentTermLabel ?? undefined,
      paymentTermDays: (quote as any).paymentTermDays ?? undefined,
      deliveryLeadTimeDays: (quote as any).deliveryLeadTimeDays ?? undefined,
      deliveryTerms: (quote as any).deliveryTerms ?? undefined,
      incotermCode: (quote as any).incotermCode ?? undefined,
      incotermLocation: (quote as any).incotermLocation ?? undefined,
      exchangeRate: (quote as any).exchangeRate ?? undefined,
      commercialConditions: (quote as any).commercialConditions ?? undefined,
      discountAmount: Number(quote.discountAmount ?? 0),
      items: (quote.items as any[]).map((item, index) => ({
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
        discount: Number(item.discount),
        position: index + 1,
      })),
    }, userId);
    await this.logQuoteAudit(companyId, id, 'QUOTE_DUPLICATED', userId, {
      sourceQuoteId: id,
      sourceNumber: quote.number,
    }, {
      duplicatedQuoteId: duplicated.id,
      duplicatedNumber: duplicated.number,
    });
    return duplicated;
  }

  async renew(companyId: string, id: string, userId: string) {
    const quote = await this.findOne(companyId, id);
    const renewed = await this.duplicate(companyId, id, userId);
    await this.prisma.quote.update({
      where: { id },
      data: {
        status: quote.status === 'EXPIRED' ? 'EXPIRED' : quote.status,
      },
    });
    return renewed;
  }

  async getFollowUps(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.$queryRawUnsafe<QuoteFollowUpRow[]>(
      `
        SELECT "id", "quoteId", "activityType", "notes", "scheduledAt", "createdById", "createdAt"
        FROM "quote_followups"
        WHERE "companyId" = $1 AND "quoteId" = $2
        ORDER BY COALESCE("scheduledAt", "createdAt") DESC, "createdAt" DESC
      `,
      companyId,
      id,
    );
  }

  async createFollowUp(companyId: string, id: string, dto: CreateQuoteFollowUpDto, userId: string) {
    await this.findOne(companyId, id);
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_followups" (
          "id", "companyId", "quoteId", "activityType", "notes", "scheduledAt", "createdById", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      randomUUID(),
      companyId,
      id,
      dto.activityType,
      dto.notes,
      dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      userId,
    );

    await this.logQuoteAudit(companyId, id, 'QUOTE_FOLLOWUP_CREATED', userId, null, {
      activityType: dto.activityType,
      notes: dto.notes,
      scheduledAt: dto.scheduledAt ?? null,
    });

    return this.getFollowUps(companyId, id);
  }

  async getAttachments(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.$queryRawUnsafe<QuoteAttachmentRow[]>(
      `
        SELECT
          qa."id",
          qa."quoteId",
          qa."fileName",
          qa."fileUrl",
          qa."mimeType",
          qa."category",
          qa."notes",
          qa."sizeBytes",
          qa."uploadedById",
          TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))) AS "uploadedByName",
          qa."createdAt",
          qa."updatedAt"
        FROM "quote_attachments" qa
        LEFT JOIN "users" u ON u."id" = qa."uploadedById"
        WHERE qa."companyId" = $1 AND qa."quoteId" = $2
        ORDER BY qa."createdAt" DESC
      `,
      companyId,
      id,
    );
  }

  async createAttachment(companyId: string, id: string, dto: CreateQuoteAttachmentDto, userId: string) {
    await this.findOne(companyId, id);
    const fileName = dto.fileName?.trim();
    const fileUrl = dto.fileUrl?.trim();
    if (!fileName) throw new BadRequestException('El nombre del adjunto es obligatorio');
    if (!fileUrl) throw new BadRequestException('La URL del adjunto es obligatoria');

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_attachments" (
          "id", "companyId", "quoteId", "fileName", "fileUrl", "mimeType", "category", "notes", "sizeBytes", "uploadedById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      `,
      randomUUID(),
      companyId,
      id,
      fileName,
      fileUrl,
      this.normalizeOptional(dto.mimeType),
      this.normalizeOptional(dto.category),
      this.normalizeOptional(dto.notes),
      dto.sizeBytes ?? null,
      userId,
    );

    await this.logQuoteAudit(companyId, id, 'QUOTE_ATTACHMENT_CREATED', userId, null, {
      fileName,
      fileUrl,
      category: dto.category ?? null,
    });

    return this.getAttachments(companyId, id);
  }

  async getComments(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.$queryRawUnsafe<QuoteCommentRow[]>(
      `
        SELECT
          qc."id",
          qc."quoteId",
          qc."commentType",
          qc."message",
          qc."createdById",
          TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))) AS "createdByName",
          qc."createdAt",
          qc."updatedAt"
        FROM "quote_comments" qc
        LEFT JOIN "users" u ON u."id" = qc."createdById"
        WHERE qc."companyId" = $1 AND qc."quoteId" = $2
        ORDER BY qc."createdAt" DESC
      `,
      companyId,
      id,
    );
  }

  async createComment(companyId: string, id: string, dto: CreateQuoteCommentDto, userId: string) {
    await this.findOne(companyId, id);
    const message = dto.message?.trim();
    if (!message) throw new BadRequestException('El comentario es obligatorio');

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_comments" (
          "id", "companyId", "quoteId", "commentType", "message", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `,
      randomUUID(),
      companyId,
      id,
      dto.commentType?.trim() || 'INTERNAL',
      message,
      userId,
    );

    await this.logQuoteAudit(companyId, id, 'QUOTE_COMMENT_CREATED', userId, null, {
      commentType: dto.commentType?.trim() || 'INTERNAL',
      message,
    });

    return this.getComments(companyId, id);
  }

  async getAuditTrail(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.$queryRawUnsafe<QuoteAuditTrailRow[]>(
      `
        SELECT
          al."id",
          al."action",
          al."resource",
          al."resourceId",
          al."before",
          al."after",
          al."userId",
          al."createdAt",
          TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))) AS "userName"
        FROM "audit_logs" al
        LEFT JOIN "users" u ON u."id" = al."userId"
        WHERE al."companyId" = $1
          AND al."resource" = 'QUOTE'
          AND al."resourceId" = $2
        ORDER BY al."createdAt" DESC
      `,
      companyId,
      id,
    );
  }

  async getIntegrationSummary(companyId: string, id: string) {
    const quote = await this.findOne(companyId, id);
    const inventory = await this.getInventoryIntegration(companyId, quote.items as any[]);

    return {
      quoteId: quote.id,
      quoteNumber: quote.number,
      sales: {
        status: quote.status,
        canConvertToInvoice: quote.status === 'ACCEPTED' && !quote.invoiceId,
        hasInvoice: Boolean(quote.invoiceId),
        invoiceId: quote.invoiceId ?? null,
        invoiceNumber: quote.invoice?.invoiceNumber ?? null,
      },
      fiscal: {
        canSendToDian: quote.status === 'ACCEPTED' || quote.status === 'CONVERTED',
        requiresInvoiceCreation: !quote.invoiceId,
        dianFlowLabel: quote.invoiceId ? 'Factura lista para DIAN' : 'Se convertirá a factura antes de DIAN',
      },
      inventory,
    };
  }

  async sendToDian(companyId: string, id: string, userId: string) {
    const quote = await this.findOne(companyId, id);
    if (!['ACCEPTED', 'CONVERTED'].includes(quote.status)) {
      throw new BadRequestException('Solo las cotizaciones aceptadas o convertidas pueden enviarse a DIAN');
    }

    let invoiceId = quote.invoiceId ?? null;
    let invoiceNumber = quote.invoice?.invoiceNumber ?? null;

    if (!invoiceId) {
      const invoice = await this.convertToInvoice(companyId, id, userId);
      invoiceId = invoice.id;
      invoiceNumber = invoice.invoiceNumber ?? null;
    }

    const result = await this.invoicesService.sendToDian(companyId, 'quotes', invoiceId);
    await this.logQuoteAudit(companyId, id, 'QUOTE_SENT_TO_DIAN', userId, {
      invoiceId,
      invoiceNumber,
    }, {
      invoiceId,
      invoiceNumber,
      dianZipKey: (result as any)?.dianZipKey ?? null,
      status: 'SENT_TO_DIAN',
    });

    return {
      invoiceId,
      invoiceNumber,
      ...(result as any),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ELIMINAR cotización — soft-delete, solo permite DRAFT
  // ─────────────────────────────────────────────────────────────────────────────
  async remove(companyId: string, id: string, userId?: string) {
    const quote = await this.findOne(companyId, id);

    if (quote.status !== 'DRAFT') {
      throw new ForbiddenException(
        `Solo se pueden eliminar cotizaciones en estado DRAFT. Estado actual: ${quote.status}`,
      );
    }

    const removed = await this.prisma.quote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.logQuoteAudit(companyId, id, 'QUOTE_DELETED', userId ?? null, {
      status: quote.status,
      number: quote.number,
    }, {
      deletedAt: removed.deletedAt,
    });
    return removed;
  }

  private async logQuoteAudit(
    companyId: string,
    quoteId: string,
    action: string,
    userId?: string | null,
    before?: any,
    after?: any,
  ) {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: userId ?? null,
        action,
        resource: 'QUOTE',
        resourceId: quoteId,
        before: before === undefined ? undefined : this.toJsonValue(before),
        after: after === undefined ? undefined : this.toJsonValue(after),
      },
    });
  }

  private toJsonValue(value: any) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  private async getInventoryIntegration(companyId: string, items: Array<{ productId?: string; quantity?: any; description?: string }> = []) {
    const productIds = Array.from(new Set(items.map((item) => item.productId).filter(Boolean))) as string[];
    if (!productIds.length) {
      return {
        checkedLines: 0,
        availableLines: 0,
        unavailableLines: 0,
        lowStockLines: 0,
        lines: [],
      };
    }

    const products = await this.prisma.$queryRawUnsafe<QuoteInventoryIntegrationRow[]>(
      `
        SELECT
          "id" AS "productId",
          "sku",
          "name",
          "unit",
          "status",
          "stock",
          "minStock"
        FROM "products"
        WHERE "companyId" = $1
          AND "deletedAt" IS NULL
          AND "id" = ANY($2)
      `,
      companyId,
      productIds,
    );

    const productMap = new Map(products.map((product) => [product.productId, product]));
    const lines = items
      .filter((item) => item.productId)
      .map((item, index) => {
        const product = productMap.get(item.productId as string);
        const requestedQuantity = Number(item.quantity ?? 0);
        const currentStock = Number(product?.stock ?? 0);
        const minStock = Number(product?.minStock ?? 0);
        const shortage = Math.max(0, requestedQuantity - currentStock);
        return {
          lineIndex: index + 1,
          productId: item.productId as string,
          description: item.description ?? product?.name ?? 'Producto',
          sku: product?.sku ?? '',
          unit: product?.unit ?? 'UND',
          status: product?.status ?? 'UNKNOWN',
          requestedQuantity,
          currentStock,
          minStock,
          enoughStock: shortage <= 0,
          shortage,
          lowStock: currentStock <= minStock,
        };
      });

    return {
      checkedLines: lines.length,
      availableLines: lines.filter((line) => line.enoughStock).length,
      unavailableLines: lines.filter((line) => !line.enoughStock).length,
      lowStockLines: lines.filter((line) => line.lowStock).length,
      lines,
    };
  }

  private async ensureCommercialSelectionsBelongToCompany(
    companyId: string,
    priceListId?: string | null,
    templateId?: string | null,
  ) {
    if (priceListId) {
      const priceList = await this.prisma.quotePriceList.findFirst({
        where: { id: priceListId, companyId, isActive: true },
        select: { id: true },
      });
      if (!priceList) {
        throw new BadRequestException('La lista de precios seleccionada no pertenece a la empresa o no está activa');
      }
    }

    if (templateId) {
      const template = await this.prisma.quoteTemplate.findFirst({
        where: { id: templateId, companyId, isActive: true },
        select: { id: true },
      });
      if (!template) {
        throw new BadRequestException('La plantilla seleccionada no pertenece a la empresa o no está activa');
      }
    }
  }

  private async getApplicableApprovalPolicies(companyId: string, total: number, items: Array<{ discount?: any }> = []) {
    const policies = await this.getApprovalPolicies(companyId);
    const maxDiscount = items.reduce((acc, item) => Math.max(acc, Number(item?.discount ?? 0)), 0);
    return policies.filter((policy) => {
      if (policy.approvalType === 'TOTAL') return total >= Number(policy.thresholdValue ?? 0);
      if (policy.approvalType === 'DISCOUNT') return maxDiscount >= Number(policy.thresholdValue ?? 0);
      return false;
    });
  }

  private async requiresApproval(companyId: string, total: number, items: Array<{ discount?: any }> = []) {
    const applicablePolicies = await this.getApplicableApprovalPolicies(companyId, total, items);
    if (applicablePolicies.length) return true;
    const hasHighDiscount = items.some((item) => Number(item?.discount ?? 0) >= APPROVAL_DISCOUNT_THRESHOLD);
    return total >= APPROVAL_TOTAL_THRESHOLD || hasHighDiscount;
  }

  private async getApprovalFlow(companyId: string, quoteId: string) {
    const rows = await this.prisma.$queryRawUnsafe<QuoteApprovalRow[]>(
      `
        SELECT *
        FROM "quote_approval_requests"
        WHERE "companyId" = $1 AND "quoteId" = $2
        ORDER BY "sequence" ASC, "createdAt" ASC
      `,
      companyId,
      quoteId,
    );
    return rows.map((row) => ({
      ...row,
      sequence: Number(row.sequence ?? 1),
      thresholdValue: row.thresholdValue !== null && row.thresholdValue !== undefined ? Number(row.thresholdValue) : null,
    }));
  }

  private async getApprovalSummary(companyId: string, quoteId: string) {
    const flow = await this.getApprovalFlow(companyId, quoteId);
    const pending = flow.find((row) => row.status === 'PENDING');
    if (pending) return pending;
    return flow[flow.length - 1] ?? null;
  }

  private async supersedeApprovalFlow(companyId: string, quoteId: string) {
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "quote_approval_requests"
        SET "status" = 'SUPERSEDED',
            "updatedAt" = NOW()
        WHERE "companyId" = $1
          AND "quoteId" = $2
          AND "status" IN ('PENDING', 'APPROVED')
      `,
      companyId,
      quoteId,
    );
  }

  private async createApprovalFlow(companyId: string, quoteId: string, reason: string, userId: string, total: number, items: Array<{ discount?: any }> = []) {
    const applicablePolicies = await this.getApplicableApprovalPolicies(companyId, total, items);
    const flow = applicablePolicies.length
      ? applicablePolicies.map((policy) => ({
          sequence: Number(policy.sequence ?? 1),
          policyName: policy.name,
          requiredRole: policy.requiredRole,
          thresholdType: policy.approvalType,
          thresholdValue: Number(policy.thresholdValue ?? 0),
          reason: `${reason} · ${policy.name}`,
        }))
      : [{
          sequence: 1,
          policyName: 'Política comercial general',
          requiredRole: 'MANAGER',
          thresholdType: total >= APPROVAL_TOTAL_THRESHOLD ? 'TOTAL' : 'DISCOUNT',
          thresholdValue: total >= APPROVAL_TOTAL_THRESHOLD ? APPROVAL_TOTAL_THRESHOLD : APPROVAL_DISCOUNT_THRESHOLD,
          reason,
        }];

    for (const step of flow) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "quote_approval_requests" (
            "id", "companyId", "quoteId", "status", "reason", "sequence", "policyName", "requiredRole",
            "thresholdType", "thresholdValue", "requestedById", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        `,
        randomUUID(),
        companyId,
        quoteId,
        step.reason,
        step.sequence,
        step.policyName,
        step.requiredRole,
        step.thresholdType,
        step.thresholdValue,
        userId,
      );
    }
  }

  private async ensureQuoteCanProceed(companyId: string, id: string, quote: any) {
    if (quote.status === 'EXPIRED') {
      throw new BadRequestException('La cotización está vencida y debe renovarse antes de continuar');
    }

    if (!(await this.requiresApproval(companyId, Number(quote.total), quote.items as any[]))) {
      return;
    }

    const flow = await this.getApprovalFlow(companyId, id);
    if (!flow.length) {
      throw new BadRequestException('La cotización requiere aprobación comercial antes de enviarse, aceptarse o convertirse');
    }
    const rejectedStep = flow.find((step) => step.status === 'REJECTED');
    if (rejectedStep) {
      throw new BadRequestException('La cotización tiene un paso de aprobación rechazado y debe solicitarse nuevamente');
    }
    const pendingStep = flow.find((step) => step.status === 'PENDING');
    if (pendingStep) {
      throw new BadRequestException(
        `La cotización tiene aprobaciones pendientes en el nivel ${pendingStep.sequence} (${pendingStep.requiredRole ?? 'sin rol definido'})`,
      );
    }
    const hasNonApproved = flow.some((step) => step.status !== 'APPROVED');
    if (hasNonApproved) {
      throw new BadRequestException('La cotización debe completar nuevamente su flujo de aprobación antes de continuar');
    }
  }

  private async getLatestApproval(companyId: string, quoteId: string) {
    return this.getApprovalSummary(companyId, quoteId);
  }

  private async getCurrentVersionNumber(companyId: string, quoteId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ versionNumber: number }>>(
      `
        SELECT COALESCE(MAX("versionNumber"), 0) AS "versionNumber"
        FROM "quote_versions"
        WHERE "companyId" = $1 AND "quoteId" = $2
      `,
      companyId,
      quoteId,
    );
    return Number(rows[0]?.versionNumber ?? 0);
  }

  private async createVersionSnapshot(
    companyId: string,
    quoteId: string,
    action: string,
    snapshot: any,
    userId: string | null,
  ) {
    const nextVersion = (await this.getCurrentVersionNumber(companyId, quoteId)) + 1;
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "quote_versions" (
          "id", "companyId", "quoteId", "versionNumber", "action", "snapshot", "createdById", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, CAST($6 AS jsonb), $7, NOW())
      `,
      randomUUID(),
      companyId,
      quoteId,
      nextVersion,
      action,
      JSON.stringify(snapshot),
      userId,
    );
  }

  private async attachCommercialMetadata(companyId: string, quotes: any[]) {
    if (!quotes.length) return [];
    const quoteIds = quotes.map((quote) => quote.id);

    const [approvals, versions, advancedFieldsMap] = await Promise.all([
      this.prisma.$queryRawUnsafe<QuoteApprovalRow[]>(
        `
          SELECT *
          FROM "quote_approval_requests"
          WHERE "companyId" = $1 AND "quoteId" = ANY($2)
          ORDER BY "quoteId" ASC, "sequence" ASC, "createdAt" ASC
        `,
        companyId,
        quoteIds,
      ),
      this.prisma.$queryRawUnsafe<Array<{ quoteId: string; versionNumber: number }>>(
        `
          SELECT "quoteId", COALESCE(MAX("versionNumber"), 0) AS "versionNumber"
          FROM "quote_versions"
          WHERE "companyId" = $1 AND "quoteId" = ANY($2)
          GROUP BY "quoteId"
        `,
        companyId,
        quoteIds,
      ),
      this.getAdvancedCommercialFields(companyId, quoteIds),
    ]);

    const approvalsMap = new Map<string, QuoteApprovalRow | null>();
    for (const quoteId of quoteIds) {
      const flow = approvals
        .filter((row) => row.quoteId === quoteId)
        .map((row) => ({
          ...row,
          sequence: Number(row.sequence ?? 1),
          thresholdValue: row.thresholdValue !== null && row.thresholdValue !== undefined ? Number(row.thresholdValue) : null,
        }));
      approvalsMap.set(
        quoteId,
        flow.find((row) => row.status === 'PENDING') ?? flow[flow.length - 1] ?? null,
      );
    }
    const versionsMap = new Map(versions.map((row) => [row.quoteId, Number(row.versionNumber)]));
    const enriched = [];
    for (const quote of quotes) {
      enriched.push(this.normalizeQuoteSelections({
        ...quote,
        ...(advancedFieldsMap.get(quote.id) ?? {}),
        approval: approvalsMap.get(quote.id) ?? null,
        approvalRequired: await this.requiresApproval(companyId, Number(quote.total), quote.items as any[]),
        currentVersion: versionsMap.get(quote.id) ?? 0,
      }));
    }
    return enriched;
  }

  private normalizeQuoteSelections<T extends Record<string, any>>(quote: T): T & {
    priceListId?: string | null;
    templateId?: string | null;
  } {
    return {
      ...quote,
      priceListId: quote.priceListId ?? quote.selectedPriceListId ?? null,
      templateId: quote.templateId ?? quote.selectedTemplateId ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERAR PDF — Genera un PDF real de la cotización usando coordenadas raw PDF
  // Mismo formato visual que las facturas (buildInvoicePdfBuffer en invoices.service)
  // ─────────────────────────────────────────────────────────────────────────────
  async generatePdf(companyId: string, quoteId: string): Promise<Buffer> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, companyId, deletedAt: null },
      include: {
        customer: true,
        items: { orderBy: { position: 'asc' } },
      },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    const advancedFields = (await this.getAdvancedCommercialFields(companyId, [quoteId])).get(quoteId);
    Object.assign(quote as any, advancedFields ?? {});

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 34;
    const topMargin = 36;
    const bottomMargin = 36;
    const contentWidth = pageWidth - marginX * 2;

    const colors = {
      navy:    [19, 52, 99]    as [number, number, number],
      blue:    [36, 99, 235]   as [number, number, number],
      slate:   [71, 85, 105]   as [number, number, number],
      text:    [15, 23, 42]    as [number, number, number],
      muted:   [100, 116, 139] as [number, number, number],
      line:    [203, 213, 225] as [number, number, number],
      soft:    [241, 245, 249] as [number, number, number],
      greenBg: [220, 252, 231] as [number, number, number],
      greenText: [22, 101, 52] as [number, number, number],
      amberBg: [254, 243, 199] as [number, number, number],
      amberText: [146, 64, 14] as [number, number, number],
      redBg:   [254, 226, 226] as [number, number, number],
      redText: [153, 27, 27]   as [number, number, number],
      white:   [255, 255, 255] as [number, number, number],
      black:   [0, 0, 0]       as [number, number, number],
    };

    const fmtCOP = (v: any) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(v ?? 0));
    const fmtDate = (d: any) =>
      d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

    const statusLabel = (s: string) =>
      ({ DRAFT: 'BORRADOR', SENT: 'ENVIADA', ACCEPTED: 'ACEPTADA', REJECTED: 'RECHAZADA', EXPIRED: 'VENCIDA', CONVERTED: 'CONVERTIDA' }[s] ?? s ?? '-');

    const statusStyle = (status: string) => {
      if (status === 'ACCEPTED' || status === 'CONVERTED') return { bg: colors.greenBg, text: colors.greenText };
      if (status === 'DRAFT' || status === 'SENT') return { bg: colors.amberBg, text: colors.amberText };
      if (status === 'REJECTED' || status === 'EXPIRED') return { bg: colors.redBg, text: colors.redText };
      return { bg: colors.soft, text: colors.text };
    };

    const normalizeText = (value: any) =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const pdfSafe = (value: any) =>
      normalizeText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

    const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56;

    const wrapText = (text: any, maxWidth: number, fontSize: number) => {
      const normalized = normalizeText(text);
      if (!normalized) return ['-'];
      const words = normalized.split(' ');
      const lines: string[] = [];
      let current = '';
      const splitLongToken = (token: string) => {
        const parts: string[] = [];
        let chunk = '';
        for (const char of token) {
          const candidate = `${chunk}${char}`;
          if (chunk && estimateTextWidth(candidate, fontSize) > maxWidth) {
            parts.push(chunk);
            chunk = char;
          } else {
            chunk = candidate;
          }
        }
        if (chunk) parts.push(chunk);
        return parts;
      };
      for (const word of words) {
        if (estimateTextWidth(word, fontSize) > maxWidth) {
          if (current) { lines.push(current); current = ''; }
          lines.push(...splitLongToken(word));
          continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : ['-'];
    };

    const pages: Array<{ content: string; annots: string[] }> = [];
    let commands: string[] = [];
    let annotations: string[] = [];
    let y = topMargin;

    const toPdfY = (topY: number) => pageHeight - topY;
    const pushPage = () => {
      if (commands.length || annotations.length) pages.push({ content: commands.join('\n'), annots: [...annotations] });
      commands = [];
      annotations = [];
      y = topMargin;
    };
    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - bottomMargin) return;
      pushPage();
    };
    const setFill   = (rgb: [number, number, number]) => commands.push(`${(rgb[0]/255).toFixed(3)} ${(rgb[1]/255).toFixed(3)} ${(rgb[2]/255).toFixed(3)} rg`);
    const setStroke = (rgb: [number, number, number]) => commands.push(`${(rgb[0]/255).toFixed(3)} ${(rgb[1]/255).toFixed(3)} ${(rgb[2]/255).toFixed(3)} RG`);
    const setLineWidth = (width: number) => commands.push(`${width.toFixed(2)} w`);
    const addRect = (x: number, topY: number, width: number, height: number, mode: 'S'|'f'|'B' = 'S') => {
      commands.push(`${x.toFixed(2)} ${toPdfY(topY+height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${mode}`);
    };
    const addLine = (x1: number, topY1: number, x2: number, topY2: number) => {
      commands.push(`${x1.toFixed(2)} ${toPdfY(topY1).toFixed(2)} m ${x2.toFixed(2)} ${toPdfY(topY2).toFixed(2)} l S`);
    };
    const addText = (text: any, x: number, topY: number, options?: { size?: number; font?: 'F1'|'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const font = options?.font ?? 'F1';
      if (options?.color) setFill(options.color);
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${toPdfY(topY).toFixed(2)} Tm (${pdfSafe(text) || '-'}) Tj ET`);
    };
    const addRightText = (text: any, rightX: number, topY: number, options?: { size?: number; font?: 'F1'|'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const normalized = normalizeText(text) || '-';
      const width = estimateTextWidth(normalized, size);
      addText(normalized, Math.max(marginX, rightX - width), topY, options);
    };
    const drawTextBlock = (lines: string[], x: number, topY: number, lineHeight: number, options?: { size?: number; font?: 'F1'|'F2'; color?: [number, number, number] }) => {
      lines.forEach((line, idx) => addText(line, x, topY + idx * lineHeight, options));
    };
    const drawLabelValueRows = (rows: Array<{ label: string; value: string[] }>, x: number, topY: number, width: number) => {
      const labelWidth = Math.min(86, width * 0.34);
      const valueX = x + labelWidth + 10;
      const valueWidth = Math.max(70, width - labelWidth - 10);
      let cursorY = topY;
      for (const row of rows) {
        addText(row.label, x, cursorY, { size: 9, font: 'F2', color: colors.muted });
        const wrappedLines = row.value.flatMap((line) => wrapText(line, valueWidth, 10));
        wrappedLines.forEach((line, idx) => {
          addText(line, valueX, cursorY + idx * 11, { size: 10, color: colors.text });
        });
        cursorY += Math.max(18, wrappedLines.length * 11 + 6);
      }
      return cursorY - topY;
    };
    const estimateLabelValueRowsHeight = (rows: Array<{ label: string; value: string[] }>, width: number) => {
      const labelWidth = Math.min(86, width * 0.34);
      const valueWidth = Math.max(70, width - labelWidth - 10);
      return rows.reduce((acc, row) => {
        const wrappedLines = row.value.flatMap((line) => wrapText(line, valueWidth, 10));
        return acc + Math.max(18, wrappedLines.length * 11 + 6);
      }, 0);
    };
    const sectionTitle = (title: string, accent: [number, number, number] = colors.navy) => {
      ensureSpace(28);
      setFill(accent);
      addRect(marginX, y, 4, 14, 'f');
      addText(title, marginX + 12, y + 11, { size: 12, font: 'F2', color: colors.text });
      y += 24;
    };

    // ── Header ────────────────────────────────────────────────────────────────
    setFill(colors.soft);
    addRect(0, 0, pageWidth, 18, 'f');
    setFill(colors.navy);
    addRect(0, 18, pageWidth, 96, 'f');
    addText(company?.name ?? 'BeccaFact', marginX, 52, { size: 22, font: 'F2', color: colors.white });
    const companyMeta = [
      company?.razonSocial || '',
      `NIT ${company?.nit ?? '-'}`,
      [company?.email, company?.phone].filter(Boolean).join(' · '),
      [company?.address, company?.city].filter(Boolean).join(', '),
    ].filter(Boolean);
    drawTextBlock(companyMeta.map(normalizeText), marginX, 72, 13, { size: 10, color: [226, 232, 240] });

    // Meta box (numero, fecha, estado)
    const metaWidth = 210;
    const metaX = pageWidth - marginX - metaWidth;
    const metaY = 34;
    setFill(colors.white);
    addRect(metaX, metaY, metaWidth, 78, 'f');
    setStroke([214, 223, 233]);
    setLineWidth(0.8);
    addRect(metaX, metaY, metaWidth, 78, 'S');
    addText('COTIZACION', metaX + 14, metaY + 18, { size: 12, font: 'F2', color: colors.navy });
    addText(quote.number ?? '-', metaX + 14, metaY + 40, { size: 21, font: 'F2', color: colors.text });
    addText(`Emision ${fmtDate(quote.issueDate)}`, metaX + 14, metaY + 58, { size: 9, color: colors.muted });
    if (quote.expiresAt) addText(`Vigencia ${fmtDate(quote.expiresAt)}`, metaX + 14, metaY + 70, { size: 9, color: colors.muted });

    const badge = statusStyle(quote.status as string);
    const badgeWidth = Math.max(70, estimateTextWidth(statusLabel(quote.status as string), 9) + 20);
    setFill(badge.bg);
    addRect(metaX + metaWidth - badgeWidth - 14, metaY + 12, badgeWidth, 18, 'f');
    addText(statusLabel(quote.status as string), metaX + metaWidth - badgeWidth - 4, metaY + 24, { size: 9, font: 'F2', color: badge.text });

    y = 132;

    // ── Cards cliente + resumen ────────────────────────────────────────────────
    const cardGap = 14;
    const cardWidth = (contentWidth - cardGap) / 2;
    const customerRows = [
      { label: 'Cliente',    value: [(quote.customer as any)?.name ?? '-'] },
      { label: 'Documento',  value: [(quote.customer as any)?.documentNumber ?? '-'] },
      ...((quote.customer as any)?.email    ? [{ label: 'Email',     value: [(quote.customer as any).email] }] : []),
      ...((quote.customer as any)?.phone    ? [{ label: 'Telefono',  value: [(quote.customer as any).phone] }] : []),
      ...((quote.customer as any)?.address  ? [{ label: 'Direccion', value: [(quote.customer as any).address] }] : []),
    ];
    const summaryRows = [
      { label: 'Moneda',    value: [normalizeText(quote.currency ?? 'COP')] },
      ...(Number((quote as any).exchangeRate ?? 1) !== 1 ? [{ label: 'Tasa cambio', value: [normalizeText(String(Number((quote as any).exchangeRate ?? 1)))] }] : []),
      ...((quote as any).paymentTermLabel ? [{ label: 'Pago', value: [normalizeText((quote as any).paymentTermLabel)] }] : []),
      ...((quote as any).paymentTermDays != null ? [{ label: 'Plazo', value: [normalizeText(`${Number((quote as any).paymentTermDays)} dias`)] }] : []),
      { label: 'Subtotal',  value: [normalizeText(fmtCOP(quote.subtotal))] },
      { label: 'IVA',       value: [normalizeText(fmtCOP(quote.taxAmount))] },
      { label: 'Descuento', value: [normalizeText(fmtCOP(quote.discountAmount ?? 0))] },
      { label: 'Total',     value: [normalizeText(fmtCOP(quote.total))] },
    ];
    const infoCardInnerWidth = cardWidth - 28;
    const infoCardHeight = Math.max(
      132,
      24 + Math.max(
        estimateLabelValueRowsHeight(customerRows, infoCardInnerWidth),
        estimateLabelValueRowsHeight(summaryRows, infoCardInnerWidth),
      ) + 34,
    );
    ensureSpace(infoCardHeight + 8);

    setFill(colors.white);
    setStroke(colors.line);
    setLineWidth(0.8);
    addRect(marginX, y, cardWidth, infoCardHeight, 'B');
    addRect(marginX + cardWidth + cardGap, y, cardWidth, infoCardHeight, 'B');
    setFill(colors.soft);
    addRect(marginX, y, cardWidth, 28, 'f');
    addRect(marginX + cardWidth + cardGap, y, cardWidth, 28, 'f');
    addText('Cliente / Receptor', marginX + 14, y + 18, { size: 11, font: 'F2', color: colors.navy });
    addText('Resumen financiero', marginX + cardWidth + cardGap + 14, y + 18, { size: 11, font: 'F2', color: colors.navy });
    drawLabelValueRows(customerRows, marginX + 14, y + 46, infoCardInnerWidth);
    drawLabelValueRows(summaryRows, marginX + cardWidth + cardGap + 14, y + 46, infoCardInnerWidth);
    y += infoCardHeight + 18;

    // ── Tabla de items ─────────────────────────────────────────────────────────
    sectionTitle(`Detalle de productos / servicios (${Array.isArray(quote.items) ? quote.items.length : 0})`, colors.blue);

    const columns = {
      idx:       marginX + 10,
      desc:      marginX + 42,
      qtyRight:  marginX + 332,
      unitRight: marginX + 414,
      taxRight:  marginX + 464,
      totalRight: pageWidth - marginX - 12,
    };

    const drawTableHeader = () => {
      ensureSpace(30);
      setFill(colors.navy);
      addRect(marginX, y, contentWidth, 24, 'f');
      addText('#',           columns.idx,       y + 15, { size: 9, font: 'F2', color: colors.white });
      addText('Descripcion', columns.desc,      y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Cant.',  columns.qtyRight,  y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Precio', columns.unitRight, y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('IVA',    columns.taxRight,  y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Total',  columns.totalRight,y + 15, { size: 9, font: 'F2', color: colors.white });
      y += 24;
    };
    drawTableHeader();

    const items = Array.isArray(quote.items) ? quote.items : [];
    items.forEach((item: any, index: number) => {
      const descriptionLines = wrapText(item.description ?? '-', 250, 9);
      const metaBits = [
        item.product?.sku ? `SKU ${normalizeText(item.product.sku)}` : '',
        Number(item.discount ?? 0) > 0 ? `Desc ${Number(item.discount)}%` : '',
      ].filter(Boolean);
      const metaLine = metaBits.join(' · ');
      const rowTextLines = [...descriptionLines, ...(metaLine ? [metaLine] : [])];
      const rowHeight = Math.max(28, rowTextLines.length * 11 + 14);
      const previousY = y;
      ensureSpace(rowHeight + 4);
      if (y === topMargin && previousY !== topMargin) drawTableHeader();

      setFill(index % 2 === 0 ? colors.white : colors.soft);
      addRect(marginX, y, contentWidth, rowHeight, 'f');
      setStroke(colors.line);
      setLineWidth(0.5);
      addRect(marginX, y, contentWidth, rowHeight, 'S');
      addText(String(index + 1), columns.idx, y + 17, { size: 9, font: 'F2', color: colors.text });
      descriptionLines.forEach((line, lineIndex) => addText(line, columns.desc, y + 16 + lineIndex * 11, { size: 9, color: colors.text }));
      if (metaLine) addText(metaLine, columns.desc, y + 16 + descriptionLines.length * 11, { size: 8, color: colors.muted });
      addRightText(String(Number(item.quantity ?? 0)), columns.qtyRight, y + 17, { size: 9, color: colors.text });
      addRightText(fmtCOP(item.unitPrice), columns.unitRight, y + 17, { size: 9, color: colors.text });
      addRightText(`${Number(item.taxRate ?? 0)}%`, columns.taxRight, y + 17, { size: 9, color: colors.text });
      addRightText(fmtCOP(item.total), columns.totalRight, y + 17, { size: 9, font: 'F2', color: colors.text });
      y += rowHeight + 4;
    });

    // ── Totales ────────────────────────────────────────────────────────────────
    y += 8;
    const totalBoxWidth = 210;
    const totalBoxX = pageWidth - marginX - totalBoxWidth;
    const totalsRows = [
      ['Subtotal', fmtCOP(quote.subtotal)],
      ['IVA',      fmtCOP(quote.taxAmount)],
      ...(Number(quote.discountAmount ?? 0) > 0 ? [['Descuento', `-${fmtCOP(quote.discountAmount)}`]] : []),
      ['TOTAL',    fmtCOP(quote.total)],
    ];
    const totalBoxHeight = 28 + totalsRows.length * 18 + 12;
    ensureSpace(totalBoxHeight + 16);
    setFill(colors.white);
    setStroke(colors.line);
    setLineWidth(0.8);
    addRect(totalBoxX, y, totalBoxWidth, totalBoxHeight, 'B');
    setFill(colors.soft);
    addRect(totalBoxX, y, totalBoxWidth, 28, 'f');
    addText('Totales', totalBoxX + 14, y + 18, { size: 11, font: 'F2', color: colors.navy });
    let totalY = y + 44;
    totalsRows.forEach(([label, value], idx) => {
      const isGrand = idx === totalsRows.length - 1;
      addText(label, totalBoxX + 14, totalY, { size: isGrand ? 11 : 10, font: isGrand ? 'F2' : 'F1', color: isGrand ? colors.navy : colors.muted });
      addRightText(value, totalBoxX + totalBoxWidth - 14, totalY, { size: isGrand ? 12 : 10, font: 'F2', color: isGrand ? colors.navy : colors.text });
      totalY += 18;
    });
    y += totalBoxHeight + 22;

    // ── Notas ─────────────────────────────────────────────────────────────────
    if (quote.notes) {
      const noteLines = wrapText(quote.notes, contentWidth - 28, 10);
      const notesHeight = 30 + noteLines.length * 12 + 14;
      ensureSpace(notesHeight + 12);
      sectionTitle('Notas / Observaciones', colors.amberText);
      setFill([255, 251, 235]);
      setStroke([253, 230, 138]);
      addRect(marginX, y, contentWidth, notesHeight, 'B');
      drawTextBlock(noteLines, marginX + 14, y + 20, 12, { size: 10, color: [120, 53, 15] });
      y += notesHeight + 18;
    }

    // ── Términos y condiciones ─────────────────────────────────────────────────
    if ((quote as any).terms) {
      const termLines = wrapText((quote as any).terms, contentWidth - 28, 10);
      const termsHeight = 30 + termLines.length * 12 + 14;
      ensureSpace(termsHeight + 12);
      sectionTitle('Terminos y condiciones', colors.slate);
      setFill(colors.soft);
      setStroke(colors.line);
      addRect(marginX, y, contentWidth, termsHeight, 'B');
      drawTextBlock(termLines, marginX + 14, y + 20, 12, { size: 10, color: colors.text });
      y += termsHeight + 18;
    }

    const advancedConditionLines = [
      (quote as any).deliveryLeadTimeDays != null ? `Tiempo de entrega: ${Number((quote as any).deliveryLeadTimeDays)} dias` : '',
      (quote as any).deliveryTerms ? `Condiciones de entrega: ${normalizeText((quote as any).deliveryTerms)}` : '',
      (quote as any).incotermCode ? `Incoterm: ${normalizeText((quote as any).incotermCode)}${(quote as any).incotermLocation ? ` ${normalizeText((quote as any).incotermLocation)}` : ''}` : '',
      (quote as any).commercialConditions ? normalizeText((quote as any).commercialConditions) : '',
    ].filter(Boolean);
    if (advancedConditionLines.length) {
      const wrapped = advancedConditionLines.flatMap((line) => wrapText(line, contentWidth - 28, 10));
      const blockHeight = 30 + wrapped.length * 12 + 14;
      ensureSpace(blockHeight + 12);
      sectionTitle('Condiciones comerciales', colors.blue);
      setFill([239, 246, 255]);
      setStroke([147, 197, 253]);
      addRect(marginX, y, contentWidth, blockHeight, 'B');
      drawTextBlock(wrapped, marginX + 14, y + 20, 12, { size: 10, color: colors.text });
      y += blockHeight + 18;
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    ensureSpace(36);
    setStroke(colors.line);
    setLineWidth(0.8);
    addLine(marginX, y, pageWidth - marginX, y);
    y += 18;
    addText(`Generado el ${new Date().toLocaleString('es-CO')}`, marginX, y, { size: 9, color: colors.muted });
    addRightText('Generado por BeccaFact', pageWidth - marginX, y, { size: 9, color: colors.muted });
    if (quote.status === 'DRAFT') {
      y += 14;
      addText('Documento en borrador - no valido como cotizacion oficial', marginX, y, { size: 9, font: 'F2', color: colors.redText });
    }

    pushPage();

    // ── Ensamblar PDF raw ──────────────────────────────────────────────────────
    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const pageObjectIds: number[] = [];
    const contentObjectIds: number[] = [];
    const pageAnnotsObjectIds: number[][] = [];
    let nextObjectId = 5;
    pages.forEach(() => {
      pageObjectIds.push(nextObjectId++);
      contentObjectIds.push(nextObjectId++);
      pageAnnotsObjectIds.push([]);
    });
    const kids = pageObjectIds.map((id) => `${id} 0 R`).join(' ');
    objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

    pages.forEach((page, index) => {
      const pageObj = pageObjectIds[index];
      const contentObj = contentObjectIds[index];
      const contentBuffer = Buffer.from(page.content, 'utf8');
      const annotRefs = '';
      objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R${annotRefs} >>`;
      objects[contentObj] = `<< /Length ${contentBuffer.length} >>\nstream\n${page.content}\nendstream`;
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = Buffer.byteLength(pdf, 'utf8');
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERAR DOCX — Genera un documento Word (.docx) de la cotización
  // ─────────────────────────────────────────────────────────────────────────────
  async generateDocx(companyId: string, quoteId: string): Promise<Buffer> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, companyId, deletedAt: null },
      include: {
        customer: true,
        items: { orderBy: { position: 'asc' } },
      },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');

    const advancedFields = (await this.getAdvancedCommercialFields(companyId, [quoteId])).get(quoteId);
    Object.assign(quote as any, advancedFields ?? {});

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });

    const fmtCOP = (v: any) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(v ?? 0));

    const fmtDate = (d: any) =>
      d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

    const statusLabel = (s: string) =>
      ({ DRAFT: 'BORRADOR', SENT: 'ENVIADA', ACCEPTED: 'ACEPTADA', REJECTED: 'RECHAZADA', EXPIRED: 'VENCIDA', CONVERTED: 'CONVERTIDA' }[s] ?? s ?? '-');

    const safe = (v: any) => String(v ?? '').trim() || '-';

    // ── Colores ────────────────────────────────────────────────────────────────
    const NAVY    = '133463'; // #133463
    const BLUE    = '2463EB'; // #2463EB
    const SLATE   = '475569';
    const SOFT_BG = 'F1F5F9';
    const WHITE   = 'FFFFFF';
    const MUTED   = '64748B';
    const GREEN_BG   = 'DCFCE7';
    const GREEN_TEXT = '166534';
    const AMBER_BG   = 'FEF3C7';
    const AMBER_TEXT = '92400E';
    const RED_BG     = 'FEE2E2';
    const RED_TEXT   = '991B1B';

    const statusColors = (s: string) => {
      if (s === 'ACCEPTED' || s === 'CONVERTED') return { bg: GREEN_BG, text: GREEN_TEXT };
      if (s === 'DRAFT' || s === 'SENT') return { bg: AMBER_BG, text: AMBER_TEXT };
      if (s === 'REJECTED' || s === 'EXPIRED') return { bg: RED_BG, text: RED_TEXT };
      return { bg: SOFT_BG, text: SLATE };
    };

    // ── Helpers para celdas de tabla ───────────────────────────────────────────
    const noBorder = {
      top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right:  { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideH: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideV: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    };

    const thinBorder = (color = 'CBD5E1') => ({
      top:    { style: BorderStyle.SINGLE, size: 4, color },
      bottom: { style: BorderStyle.SINGLE, size: 4, color },
      left:   { style: BorderStyle.SINGLE, size: 4, color },
      right:  { style: BorderStyle.SINGLE, size: 4, color },
    });

    const infoCell = (label: string, value: string, bgColor = SOFT_BG): TableCell =>
      new TableCell({
        borders: noBorder,
        shading: { type: ShadingType.SOLID, color: bgColor, fill: bgColor },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, size: 16, color: MUTED, bold: false })],
            spacing: { after: 20 },
          }),
          new Paragraph({
            children: [new TextRun({ text: value, size: 18, color: '0F172A', bold: true })],
          }),
        ],
      });

    const headerCell = (text: string): TableCell =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
        borders: noBorder,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text, color: WHITE, bold: true, size: 17 })],
          }),
        ],
      });

    const dataCell = (text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT, bg = WHITE): TableCell =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: bg, fill: bg },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
          left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
          right:  { style: BorderStyle.NONE, size: 0, color: 'auto' },
        },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: align,
            children: [new TextRun({ text, size: 17, color: '0F172A' })],
          }),
        ],
      });

    // ── 1. ENCABEZADO ─────────────────────────────────────────────────────────
    const headerTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
              borders: noBorder,
              margins: { top: 180, bottom: 180, left: 200, right: 200 },
              width: { size: 70, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: safe(company?.razonSocial || company?.name), color: WHITE, bold: true, size: 36 })],
                  spacing: { after: 60 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: `NIT: ${safe(company?.nit)}`, color: 'CBD5E1', size: 18 })],
                  spacing: { after: 40 },
                }),
                ...(company?.email ? [new Paragraph({ children: [new TextRun({ text: company.email, color: 'CBD5E1', size: 16 })] })] : []),
                ...(company?.phone ? [new Paragraph({ children: [new TextRun({ text: company.phone, color: 'CBD5E1', size: 16 })] })] : []),
                ...(company?.city  ? [new Paragraph({ children: [new TextRun({ text: company.city, color: 'CBD5E1', size: 16 })] })] : []),
              ],
            }),
            new TableCell({
              shading: { type: ShadingType.SOLID, color: BLUE, fill: BLUE },
              borders: noBorder,
              margins: { top: 180, bottom: 180, left: 200, right: 200 },
              width: { size: 30, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ text: 'COTIZACIÓN', color: WHITE, bold: true, size: 28 })],
                  spacing: { after: 80 },
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ text: safe(quote.number), color: WHITE, bold: true, size: 22 })],
                  spacing: { after: 60 },
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ text: `Estado: ${statusLabel(quote.status)}`, color: 'CBD5E1', size: 17 })],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    // ── 2. META INFO (fechas) ─────────────────────────────────────────────────
    const metaTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      rows: [
        new TableRow({
          children: [
            infoCell('Fecha de emisión', fmtDate(quote.issueDate)),
            infoCell('Fecha de vencimiento', fmtDate((quote as any).expiresAt)),
            infoCell('Moneda', safe(quote.currency)),
            (() => {
              const sc = statusColors(quote.status);
              return new TableCell({
                borders: noBorder,
                shading: { type: ShadingType.SOLID, color: sc.bg, fill: sc.bg },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: statusLabel(quote.status), color: sc.text, bold: true, size: 20 })],
                  }),
                ],
              });
            })(),
          ],
        }),
      ],
    });

    // ── 3. CLIENTE Y RESUMEN ──────────────────────────────────────────────────
    const customerTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 60, type: WidthType.PERCENTAGE },
              borders: thinBorder(),
              shading: { type: ShadingType.SOLID, color: WHITE, fill: WHITE },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'CLIENTE', color: NAVY, bold: true, size: 18 })],
                  spacing: { after: 120 },
                  heading: HeadingLevel.HEADING_3,
                }),
                new Paragraph({ children: [new TextRun({ text: safe(quote.customer?.name), bold: true, size: 20, color: '0F172A' })], spacing: { after: 60 } }),
                new Paragraph({ children: [new TextRun({ text: `Doc: ${safe(quote.customer?.documentNumber)}`, size: 17, color: SLATE })] }),
                ...(quote.customer?.email  ? [new Paragraph({ children: [new TextRun({ text: quote.customer.email,  size: 17, color: SLATE })] })] : []),
                ...(quote.customer?.phone  ? [new Paragraph({ children: [new TextRun({ text: quote.customer.phone,  size: 17, color: SLATE })] })] : []),
                ...(quote.customer?.address ? [new Paragraph({ children: [new TextRun({ text: quote.customer.address, size: 17, color: SLATE })] })] : []),
                ...(quote.customer?.city   ? [new Paragraph({ children: [new TextRun({ text: safe(quote.customer?.city), size: 17, color: SLATE })] })] : []),
              ],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              borders: thinBorder(),
              shading: { type: ShadingType.SOLID, color: SOFT_BG, fill: SOFT_BG },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'RESUMEN', color: NAVY, bold: true, size: 18 })],
                  spacing: { after: 120 },
                }),
                ...([
                  ['Subtotal',    fmtCOP(quote.subtotal)],
                  ['IVA',         fmtCOP(quote.taxAmount)],
                  ['Descuento',   fmtCOP(quote.discountAmount ?? 0)],
                  ['TOTAL',       fmtCOP(quote.total)],
                ] as [string, string][]).map(([lbl, val], idx) =>
                  new Paragraph({
                    children: [
                      new TextRun({ text: `${lbl}: `, size: idx === 3 ? 20 : 17, color: idx === 3 ? NAVY : SLATE, bold: idx === 3 }),
                      new TextRun({ text: val,         size: idx === 3 ? 20 : 17, color: idx === 3 ? NAVY : '0F172A', bold: idx === 3 }),
                    ],
                    spacing: { after: idx === 3 ? 0 : 60 },
                  })
                ),
              ],
            }),
          ],
        }),
      ],
    });

    // ── 4. TABLA DE ÍTEMS ─────────────────────────────────────────────────────
    const COL_WIDTHS = [34, 12, 18, 10, 11, 15]; // porcentajes
    const itemRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('Descripción'),
          headerCell('Cant.'),
          headerCell('Precio Unit.'),
          headerCell('Desc. %'),
          headerCell('IVA %'),
          headerCell('Total'),
        ].map((cell, i) => {
          (cell as any).options.width = { size: COL_WIDTHS[i], type: WidthType.PERCENTAGE };
          return cell;
        }),
      }),
      ...quote.items.map((item, rowIdx) => {
        const bg = rowIdx % 2 === 0 ? WHITE : SOFT_BG;
        return new TableRow({
          children: [
            dataCell(safe(item.description), AlignmentType.LEFT, bg),
            dataCell(String(Number(item.quantity)), AlignmentType.CENTER, bg),
            dataCell(fmtCOP(item.unitPrice), AlignmentType.RIGHT, bg),
            dataCell(`${Number(item.discount ?? 0)}%`, AlignmentType.CENTER, bg),
            dataCell(`${Number(item.taxRate ?? 0)}%`, AlignmentType.CENTER, bg),
            dataCell(fmtCOP(Number(item.unitPrice) * Number(item.quantity) * (1 - Number(item.discount ?? 0) / 100)), AlignmentType.RIGHT, bg),
          ],
        });
      }),
    ];

    const itemsTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: itemRows,
    });

    // ── 5. CAJA DE TOTALES ────────────────────────────────────────────────────
    const totalsTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: thinBorder(),
      rows: [
        ...([
          ['Subtotal',       fmtCOP(quote.subtotal),         false],
          ['IVA',            fmtCOP(quote.taxAmount),         false],
          ['Descuento',      fmtCOP(quote.discountAmount ?? 0), false],
          ['TOTAL A PAGAR',  fmtCOP(quote.total),             true],
        ] as [string, string, boolean][]).map(([lbl, val, isTotal]) =>
          new TableRow({
            children: [
              new TableCell({
                shading: { type: ShadingType.SOLID, color: isTotal ? NAVY : SOFT_BG, fill: isTotal ? NAVY : SOFT_BG },
                borders: noBorder,
                margins: { top: 80, bottom: 80, left: 160, right: 160 },
                children: [new Paragraph({ children: [new TextRun({ text: lbl, bold: isTotal, size: isTotal ? 20 : 17, color: isTotal ? WHITE : SLATE })] })],
              }),
              new TableCell({
                shading: { type: ShadingType.SOLID, color: isTotal ? NAVY : WHITE, fill: isTotal ? NAVY : WHITE },
                borders: noBorder,
                margins: { top: 80, bottom: 80, left: 160, right: 160 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: val, bold: isTotal, size: isTotal ? 20 : 17, color: isTotal ? WHITE : '0F172A' })] })],
              }),
            ],
          })
        ),
      ],
    });

    // ── 6. CONDICIONES COMERCIALES ────────────────────────────────────────────
    const commercialRows: TableRow[] = [];
    const addCommercial = (label: string, value: any) => {
      if (!value) return;
      commercialRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              borders: noBorder,
              shading: { type: ShadingType.SOLID, color: SOFT_BG, fill: SOFT_BG },
              margins: { top: 60, bottom: 60, left: 120, right: 60 },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 17, color: SLATE })] })],
            }),
            new TableCell({
              width: { size: 65, type: WidthType.PERCENTAGE },
              borders: noBorder,
              margins: { top: 60, bottom: 60, left: 60, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: String(value), size: 17, color: '0F172A' })] })],
            }),
          ],
        })
      );
    };

    const q = quote as any;
    addCommercial('Vendedor',           q.salesOwnerName);
    addCommercial('Oportunidad',        q.opportunityName);
    addCommercial('Canal',              q.sourceChannel);
    addCommercial('Condición de pago',  q.paymentTermLabel);
    addCommercial('Plazo (días)',        q.paymentTermDays != null ? String(q.paymentTermDays) : null);
    addCommercial('Entrega (días)',      q.deliveryLeadTimeDays != null ? String(q.deliveryLeadTimeDays) : null);
    addCommercial('Términos entrega',   q.deliveryTerms);
    addCommercial('Incoterm',           q.incotermCode ? `${q.incotermCode}${q.incotermLocation ? ' – ' + q.incotermLocation : ''}` : null);
    if (Number(q.exchangeRate ?? 1) !== 1)
      addCommercial('Tasa de cambio', `${Number(q.exchangeRate).toLocaleString('es-CO')} COP/USD`);
    addCommercial('Condiciones comerciales', q.commercialConditions);

    // ── 7. NOTAS Y TÉRMINOS ───────────────────────────────────────────────────
    const sectionParagraph = (title: string, content: string, bgColor: string, textColor: string): Table =>
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorder,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { type: ShadingType.SOLID, color: bgColor, fill: bgColor },
                borders: noBorder,
                margins: { top: 120, bottom: 120, left: 180, right: 180 },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: title, bold: true, size: 18, color: textColor })],
                    spacing: { after: 100 },
                  }),
                  new Paragraph({
                    children: [new TextRun({ text: content, size: 17, color: textColor })],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

    // ── 8. PIE DE PÁGINA ──────────────────────────────────────────────────────
    const footerPara = new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Documento generado el ${new Date().toLocaleString('es-CO')}  ·  ${safe(company?.razonSocial || company?.name)}`,
          size: 14,
          color: MUTED,
          italics: true,
        }),
      ],
      spacing: { before: 200 },
    });

    // ── ENSAMBLADO DEL DOCUMENTO ──────────────────────────────────────────────
    const children: any[] = [
      headerTable,
      new Paragraph({ spacing: { after: 120 } }),
      metaTable,
      new Paragraph({ spacing: { after: 160 } }),
      customerTable,
      new Paragraph({ spacing: { after: 200 } }),
      new Paragraph({
        children: [new TextRun({ text: 'DETALLE DE ÍTEMS', bold: true, size: 20, color: NAVY })],
        spacing: { after: 100 },
      }),
      itemsTable,
      new Paragraph({ spacing: { after: 160 } }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: '' })],
      }),
      totalsTable,
    ];

    if (commercialRows.length) {
      children.push(new Paragraph({ spacing: { after: 200 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: 'CONDICIONES COMERCIALES', bold: true, size: 20, color: NAVY })], spacing: { after: 100 } }));
      children.push(new Table({
        layout: TableLayoutType.FIXED,
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorder,
        rows: commercialRows,
      }));
    }

    if (quote.notes) {
      children.push(new Paragraph({ spacing: { after: 200 } }));
      children.push(sectionParagraph('NOTAS', safe(quote.notes), AMBER_BG, AMBER_TEXT));
    }

    if (quote.terms) {
      children.push(new Paragraph({ spacing: { after: 200 } }));
      children.push(sectionParagraph('TÉRMINOS Y CONDICIONES', safe(quote.terms), SOFT_BG, SLATE));
    }

    children.push(footerPara);

    const doc = new Document({
      creator: safe(company?.razonSocial || company?.name),
      title: `Cotización ${safe(quote.number)}`,
      description: `Cotización generada por BeccaFact`,
      sections: [
        {
          properties: {
            page: {
              margin: { top: 720, bottom: 720, left: 900, right: 900 },
            },
          },
          children,
        },
      ],
    });

    return Buffer.from(await Packer.toBuffer(doc));
  }
}
