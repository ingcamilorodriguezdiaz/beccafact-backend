/**
 * seed-sandbox.ts
 *
 * Pobla el ambiente de pruebas (sandbox) de BeccaFact.
 *
 * Reglas del sandbox:
 *  - isSandbox=true en la empresa → el backend bloquea toda transmisión a la DIAN
 *  - Sin certificado digital real ni credenciales DIAN de producción
 *  - Plan SANDBOX: todas las features habilitadas, precio $0, sin transmisión real
 *  - Empresa demo con NIT ficticio (no registrado en DIAN)
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register prisma/seed-sandbox.ts
 *   (o el script npm run sandbox:seed)
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🧪 Iniciando seed del ambiente SANDBOX de BeccaFact...\n');

  // ─── SANDBOX PLAN ────────────────────────────────────────────────────────────
  // El plan SANDBOX ya existe en el seed principal; aquí solo lo buscamos.
  let sandboxPlan = await prisma.plan.findUnique({ where: { name: 'SANDBOX' } });
  if (!sandboxPlan) {
    sandboxPlan = await prisma.plan.create({
      data: {
        name: 'SANDBOX',
        displayName: 'Sandbox (Pruebas)',
        description: 'Ambiente de pruebas controlado para clientes — sin transmisión real a la DIAN',
        price: 0,
      },
    });

    const sandboxFeatures = [
      { key: 'max_documents_per_month', value: '-1',    label: 'Documentos ilimitados (simulados)' },
      { key: 'has_invoices',            value: 'true',  label: 'Facturación electrónica (modo prueba)' },
      { key: 'dian_enabled',            value: 'false', label: 'DIAN deshabilitado — solo simulación' },
      { key: 'has_payroll',             value: 'true',  label: 'Nómina electrónica (modo prueba)' },
      { key: 'has_inventory',           value: 'true',  label: 'Inventario avanzado' },
      { key: 'has_cartera',             value: 'true',  label: 'Cartera y cobranza' },
      { key: 'has_reports',             value: 'true',  label: 'Reportes avanzados' },
      { key: 'bulk_import',             value: 'true',  label: 'Importación masiva CSV/Excel' },
      { key: 'has_pos',                 value: 'true',  label: 'Punto de Venta (POS)' },
      { key: 'has_integrations',        value: 'true',  label: 'Integraciones' },
      { key: 'has_branch',              value: 'true',  label: 'Multisede' },
      { key: 'has_accounting',          value: 'true',  label: 'Contabilidad' },
      { key: 'has_purchasing',          value: 'true',  label: 'Compras y proveedores' },
      { key: 'priority_support',        value: 'false', label: 'Soporte estándar' },
      { key: 'max_products',            value: '-1',    label: 'Productos ilimitados' },
      { key: 'max_customers',           value: '-1',    label: 'Clientes ilimitados' },
      { key: 'max_users',               value: '10',    label: '10 usuarios' },
      { key: 'max_support_tickets',     value: '2',     label: '2 tickets de soporte / mes' },
      { key: 'is_sandbox',              value: 'true',  label: 'Ambiente sandbox — sin efectos reales' },
    ];

    for (const feat of sandboxFeatures) {
      await prisma.planFeature.upsert({
        where: { planId_key: { planId: sandboxPlan.id, key: feat.key } },
        update: { value: feat.value, label: feat.label },
        create: { planId: sandboxPlan.id, ...feat },
      });
    }
    console.log('  ✅ Plan SANDBOX creado');
  } else {
    console.log('  ✅ Plan SANDBOX ya existe — omitido');
  }

  // ─── ROLES (reutilizados del seed principal) ──────────────────────────────────
  const adminRole    = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const operatorRole = await prisma.role.findUnique({ where: { name: 'OPERATOR' } });
  const cajeroRole   = await prisma.role.findUnique({ where: { name: 'CAJERO' } });
  const contadorRole = await prisma.role.findUnique({ where: { name: 'CONTADOR' } });

  if (!adminRole) {
    throw new Error('Rol ADMIN no encontrado. Ejecuta primero el seed principal: npm run prisma:seed');
  }

  // ─── EMPRESA SANDBOX ─────────────────────────────────────────────────────────
  // NIT ficticio (9999 series) — no registrado en DIAN, nunca transmite
  const SANDBOX_NIT = '999000001';

  let sandboxCompany = await prisma.company.findFirst({
    where: { nit: SANDBOX_NIT },
  });

  if (!sandboxCompany) {
    sandboxCompany = await prisma.company.create({
      data: {
        name: 'EMPRESA DEMO SANDBOX S.A.S.',
        nit: SANDBOX_NIT,
        razonSocial: 'EMPRESA DEMO SANDBOX S.A.S.',
        email: 'sandbox@beccafact.com',
        phone: '6017654321',
        address: 'Calle 100 # 9-75 Of. 501',
        city: 'Bogotá, D.C.',
        department: 'Bogotá',
        cityCode: '11001',
        departmentCode: '11',
        country: 'CO',
        status: 'ACTIVE',
        // ── Flags sandbox ──────────────────────────────────────────────
        isSandbox: true,
        dianTestMode: true,
        // Sin credenciales DIAN reales — el backend bloquea antes de intentar transmitir
        dianSoftwareId: null,
        dianSoftwarePin: null,
        dianTestSetId: null,
        dianClaveTecnica: null,
        dianCertificate: null,
        dianCertificateKey: null,
        dianResolucion: '18760000001',
        dianPrefijo: 'SAND',
        dianRangoDesde: 1,
        dianRangoHasta: 999999,
        dianFechaDesde: '2020-01-01',
        dianFechaHasta: '2030-12-31',
      } as any,
    });
    console.log(`  ✅ Empresa sandbox creada: ${sandboxCompany.name} (NIT ${SANDBOX_NIT})`);
  } else {
    // Asegurar que siempre tenga isSandbox=true aunque el registro ya existiera
    sandboxCompany = await prisma.company.update({
      where: { id: sandboxCompany.id },
      data: { isSandbox: true } as any,
    });
    console.log(`  ✅ Empresa sandbox ya existe — isSandbox sincronizado`);
  }

  // ─── SUCURSAL PRINCIPAL ───────────────────────────────────────────────────────
  let mainBranch = await prisma.branch.findFirst({
    where: { companyId: sandboxCompany.id, isMain: true },
  });
  if (!mainBranch) {
    mainBranch = await prisma.branch.create({
      data: {
        companyId: sandboxCompany.id,
        name: 'Sede Principal Sandbox',
        address: 'Calle 100 # 9-75 Of. 501',
        city: 'Bogotá, D.C.',
        phone: '6017654321',
        isMain: true,
        isActive: true,
      } as any,
    });
    console.log(`  ✅ Sucursal principal creada: ${mainBranch.name}`);
  }

  // ─── SUSCRIPCIÓN ─────────────────────────────────────────────────────────────
  const existingSub = await prisma.subscription.findFirst({ where: { companyId: sandboxCompany.id } });
  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        companyId: sandboxCompany.id,
        planId: sandboxPlan.id,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 10)),
      },
    });
    console.log('  ✅ Suscripción sandbox activa (10 años)');
  } else {
    console.log('  ✅ Suscripción sandbox ya existe — omitida');
  }

  // ─── USUARIOS SANDBOX ─────────────────────────────────────────────────────────
  console.log('\n👤 Creando usuarios sandbox...');

  const users = [
    {
      email: 'admin@sandbox.beccafact.com',
      password: 'Sandbox@Admin2025!',
      firstName: 'Administrador',
      lastName: 'Sandbox',
      role: adminRole,
      label: 'Admin',
    },
    {
      email: 'operador@sandbox.beccafact.com',
      password: 'Sandbox@Oper2025!',
      firstName: 'Operador',
      lastName: 'Sandbox',
      role: operatorRole,
      label: 'Operador',
    },
    {
      email: 'cajero@sandbox.beccafact.com',
      password: 'Sandbox@Cajero2025!',
      firstName: 'Cajero',
      lastName: 'Sandbox',
      role: cajeroRole,
      label: 'Cajero',
    },
    {
      email: 'contador@sandbox.beccafact.com',
      password: 'Sandbox@Cont2025!',
      firstName: 'Contador',
      lastName: 'Sandbox',
      role: contadorRole,
      label: 'Contador',
    },
  ];

  for (const u of users) {
    if (!u.role) continue;
    const hashed = await bcrypt.hash(u.password, 12);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        password: hashed,
        firstName: u.firstName,
        lastName: u.lastName,
        companyId: sandboxCompany.id,
        isActive: true,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: u.role.id } },
      update: {},
      create: { userId: user.id, roleId: u.role.id },
    });
    console.log(`  ✅ Usuario ${u.label}: ${u.email} / ${u.password}`);
  }

  // ─── CLIENTES SANDBOX ────────────────────────────────────────────────────────
  console.log('\n👥 Creando clientes sandbox...');

  const sandboxCustomers = [
    {
      documentType: 'NIT' as const,
      documentNumber: '800100200',
      name: 'DISTRIBUIDORA PRUEBA S.A.S.',
      email: 'compras@distribuidoraprueba.com',
      phone: '6012223344',
      address: 'Carrera 15 # 93-47',
      city: 'Bogotá, D.C.',
      department: 'Bogotá',
      country: 'CO',
      cityCode: '11001',
      departmentCode: '11',
      taxLevelCode: 'ZZ',
      creditDays: 30,
    },
    {
      documentType: 'NIT' as const,
      documentNumber: '860002345',
      name: 'COMERCIALIZADORA DEMO LTDA',
      email: 'facturas@comdemo.com',
      phone: '6024456677',
      address: 'Calle 5 # 38-25 Piso 3',
      city: 'Cali',
      department: 'Valle del Cauca',
      country: 'CO',
      cityCode: '76001',
      departmentCode: '76',
      taxLevelCode: 'ZZ',
      creditDays: 60,
    },
    {
      documentType: 'NIT' as const,
      documentNumber: '901111222',
      name: 'TECH DEMO COLOMBIA S.A.S.',
      email: 'admin@techdemo.co',
      phone: '6013334455',
      address: 'Av. El Dorado # 68C-61 Of. 502',
      city: 'Bogotá, D.C.',
      department: 'Bogotá',
      country: 'CO',
      cityCode: '11001',
      departmentCode: '11',
      taxLevelCode: 'ZZ',
      creditDays: 30,
    },
    {
      documentType: 'CC' as const,
      documentNumber: '11111111',
      name: 'JUAN PRUEBA DEMO',
      email: 'juan.demo@email.com',
      phone: '3001111111',
      address: 'Calle 50 # 45-23 Apto 301',
      city: 'Medellín',
      department: 'Antioquia',
      country: 'CO',
      cityCode: '05001',
      departmentCode: '05',
      taxLevelCode: 'ZZ',
      creditDays: 0,
    },
    {
      documentType: 'CC' as const,
      documentNumber: '22222222',
      name: 'MARIA DEMO SANDBOX',
      email: 'maria.demo@gmail.com',
      phone: '3152222222',
      address: 'Carrera 11 # 80-15 Casa 7',
      city: 'Bogotá, D.C.',
      department: 'Bogotá',
      country: 'CO',
      cityCode: '11001',
      departmentCode: '11',
      taxLevelCode: 'ZZ',
      creditDays: 0,
    },
  ];

  for (const customer of sandboxCustomers) {
    const { cityCode, departmentCode, taxLevelCode, ...customerData } = customer as any;
    await prisma.customer.upsert({
      where: {
        companyId_documentType_documentNumber: {
          companyId: sandboxCompany.id,
          documentType: customerData.documentType,
          documentNumber: customerData.documentNumber,
        },
      },
      update: {
        name: customerData.name,
        email: customerData.email,
        city: customerData.city,
        taxLevelCode,
        cityCode,
        departmentCode,
      } as any,
      create: { ...customerData, companyId: sandboxCompany.id, taxLevelCode, cityCode, departmentCode } as any,
    });
  }
  console.log(`  ✅ ${sandboxCustomers.length} clientes sandbox creados`);

  // ─── CATEGORÍAS SANDBOX ───────────────────────────────────────────────────────
  const catNames = ['Tecnología', 'Servicios Profesionales', 'Papelería y Suministros', 'Muebles y Enseres'];
  const sandboxCategories: Record<string, string> = {};
  for (const catName of catNames) {
    const cat = await prisma.category.upsert({
      where: { companyId_name: { companyId: sandboxCompany.id, name: catName } },
      update: {},
      create: { companyId: sandboxCompany.id, name: catName },
    });
    sandboxCategories[catName] = cat.id;
  }

  // ─── PRODUCTOS SANDBOX ────────────────────────────────────────────────────────
  console.log('\n📦 Creando productos sandbox...');

  const sandboxProducts = [
    {
      sku: 'SB-LAP-001',
      name: 'Laptop Demo Ryzen 5',
      description: '[SANDBOX] Computador portátil de prueba',
      categoryId: sandboxCategories['Tecnología'],
      price: 2500000,
      cost: 1800000,
      stock: 50,
      unit: 'EA',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '43211503',
    },
    {
      sku: 'SB-MON-001',
      name: 'Monitor Demo 27"',
      description: '[SANDBOX] Monitor de prueba Full HD',
      categoryId: sandboxCategories['Tecnología'],
      price: 850000,
      cost: 600000,
      stock: 30,
      unit: 'EA',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '43211708',
    },
    {
      sku: 'SB-SRV-001',
      name: 'Consultoría Demo (hora)',
      description: '[SANDBOX] Servicio de consultoría de prueba por hora',
      categoryId: sandboxCategories['Servicios Profesionales'],
      price: 150000,
      cost: 80000,
      stock: 0,
      unit: 'HUR',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '81111500',
    },
    {
      sku: 'SB-PAP-001',
      name: 'Resma Papel Demo',
      description: '[SANDBOX] Resma de papel de prueba',
      categoryId: sandboxCategories['Papelería y Suministros'],
      price: 18000,
      cost: 12000,
      stock: 200,
      unit: 'NAR',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '44111500',
    },
    {
      sku: 'SB-MUE-001',
      name: 'Silla Ergonómica Demo',
      description: '[SANDBOX] Silla de prueba ergonómica',
      categoryId: sandboxCategories['Muebles y Enseres'],
      price: 450000,
      cost: 280000,
      stock: 20,
      unit: 'EA',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '56101520',
    },
    {
      sku: 'SB-SRV-002',
      name: 'Soporte Técnico Demo (hora)',
      description: '[SANDBOX] Soporte técnico de prueba',
      categoryId: sandboxCategories['Servicios Profesionales'],
      price: 120000,
      cost: 60000,
      stock: 0,
      unit: 'HUR',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '81111811',
    },
    {
      sku: 'SB-LIC-001',
      name: 'Licencia Software Demo',
      description: '[SANDBOX] Licencia anual de prueba',
      categoryId: sandboxCategories['Servicios Profesionales'],
      price: 85000,
      cost: 40000,
      stock: 0,
      unit: 'NIU',
      taxRate: 19,
      taxType: 'IVA',
      unspscCode: '43232700',
    },
  ];

  for (const product of sandboxProducts) {
    const { unspscCode, ...productData } = product as any;
    const existing = await prisma.product.findFirst({
      where: { companyId: sandboxCompany.id, sku: productData.sku, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { unit: productData.unit, unspscCode, price: productData.price, taxRate: productData.taxRate } as any,
      });
    } else {
      await prisma.product.create({
        data: { ...productData, companyId: sandboxCompany.id, unspscCode } as any,
      });
    }
  }
  console.log(`  ✅ ${sandboxProducts.length} productos sandbox creados`);

  // ─── RESUMEN ──────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🧪 AMBIENTE SANDBOX LISTO');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n🏢 Empresa:   ${sandboxCompany.name}`);
  console.log(`   NIT:       ${SANDBOX_NIT} (ficticio — no registrado en DIAN)`);
  console.log(`   isSandbox: true  →  toda transmisión DIAN bloqueada en backend`);
  console.log('\n🔑 Credenciales de acceso:');
  console.log('   admin@sandbox.beccafact.com    / Sandbox@Admin2025!   [ADMIN]');
  console.log('   operador@sandbox.beccafact.com / Sandbox@Oper2025!    [OPERATOR]');
  console.log('   cajero@sandbox.beccafact.com   / Sandbox@Cajero2025!  [CAJERO]');
  console.log('   contador@sandbox.beccafact.com / Sandbox@Cont2025!    [CONTADOR]');
  console.log('\n⚠️  IMPORTANTE:');
  console.log('   - Los documentos se generan y numeran normalmente');
  console.log('   - Ningún documento es transmitido a la DIAN (ni pruebas ni producción)');
  console.log('   - El campo isSandbox=true bloquea el envío en invoices, payroll y POS');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => { console.error('❌ Error en seed-sandbox:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
