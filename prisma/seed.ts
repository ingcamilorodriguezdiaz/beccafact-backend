import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de BeccaFact...');

  // ─── ROLES ────────────────────────────────────────────────────────────────────
  const rolesData = [
    {
      name: 'SUPER_ADMIN',
      displayName: 'Super Administrador',
      description: 'Acceso total al sistema multi-tenant',
      isSystem: true,
      permissions: [],
    },
    {
      name: 'ADMIN',
      displayName: 'Administrador',
      description: 'Control total de la empresa',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'create' },
        { resource: 'invoices', action: 'read' },
        { resource: 'invoices', action: 'update' },
        { resource: 'invoices', action: 'delete' },
        { resource: 'invoices', action: 'export' },
        { resource: 'products', action: 'create' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'products', action: 'delete' },
        { resource: 'products', action: 'import' },
        { resource: 'customers', action: 'create' },
        { resource: 'customers', action: 'read' },
        { resource: 'customers', action: 'update' },
        { resource: 'customers', action: 'delete' },
        { resource: 'users', action: 'create' },
        { resource: 'users', action: 'read' },
        { resource: 'users', action: 'update' },
        { resource: 'users', action: 'delete' },
        { resource: 'reports', action: 'read' },
        { resource: 'integrations', action: 'create' },
        { resource: 'integrations', action: 'read' },
        { resource: 'integrations', action: 'update' },
        { resource: 'integrations', action: 'delete' },
        // Cartera: acceso completo
        { resource: 'cartera', action: 'read' },
        { resource: 'cartera', action: 'create' },
        { resource: 'cartera', action: 'update' },
        // Nómina: acceso completo
        { resource: 'payroll', action: 'read' },
        { resource: 'payroll', action: 'create' },
        { resource: 'payroll', action: 'update' },
        { resource: 'payroll', action: 'delete' },
        { resource: 'payroll', action: 'transmit' },
      ],
    },
    {
      name: 'MANAGER',
      displayName: 'Gerente',
      description: 'Gestión operativa sin configuración',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'create' },
        { resource: 'invoices', action: 'read' },
        { resource: 'invoices', action: 'update' },
        { resource: 'invoices', action: 'export' },
        { resource: 'products', action: 'create' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'products', action: 'import' },
        { resource: 'customers', action: 'create' },
        { resource: 'customers', action: 'read' },
        { resource: 'customers', action: 'update' },
        { resource: 'reports', action: 'read' },
        { resource: 'users', action: 'read' },
        // Cartera: puede registrar pagos y recordatorios
        { resource: 'cartera', action: 'read' },
        { resource: 'cartera', action: 'create' },
        { resource: 'cartera', action: 'update' },
        // Nómina: puede crear y transmitir, NO puede anular
        { resource: 'payroll', action: 'read' },
        { resource: 'payroll', action: 'create' },
        { resource: 'payroll', action: 'update' },
        { resource: 'payroll', action: 'transmit' },
      ],
    },
    {
      name: 'OPERATOR',
      displayName: 'Operador',
      description: 'Operaciones básicas de facturación e inventario',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'create' },
        { resource: 'invoices', action: 'read' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'customers', action: 'create' },
        { resource: 'customers', action: 'read' },
        // Cartera: solo consulta (no puede registrar pagos ni enviar recordatorios)
        { resource: 'cartera', action: 'read' },
        // Nómina: puede ver y crear borradores, NO puede transmitir ni anular
        { resource: 'payroll', action: 'read' },
        { resource: 'payroll', action: 'create' },
      ],
    },
    {
      name: 'VIEWER',
      displayName: 'Consultor',
      description: 'Solo lectura en todos los módulos',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'read' },
        { resource: 'products', action: 'read' },
        { resource: 'customers', action: 'read' },
        { resource: 'reports', action: 'read' },
      ],
    },
  ];

  for (const roleData of rolesData) {
    const { permissions, ...data } = roleData;
    const role = await prisma.role.upsert({
      where: { name: data.name },
      update: {},
      create: data,
    });

    for (const perm of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_resource_action: { roleId: role.id, resource: perm.resource, action: perm.action } },
        update: {},
        create: { roleId: role.id, ...perm },
      });
    }
    console.log(`  ✅ Rol: ${role.name}`);
  }

  // ─── PLANS ────────────────────────────────────────────────────────────────────
  const plansData = [
    {
      name: 'BASIC',
      displayName: 'Integración Básica',
      description: 'Para pequeñas empresas que inician con facturación electrónica',
      price: 89000,
      features: [
        { key: 'max_documents_per_month', value: '300', label: '300 documentos/mes' },
        { key: 'has_invoices', value: 'true', label: 'Facturación básica DIAN' },
        { key: 'has_inventory', value: 'false', label: 'Sin inventario' },
        { key: 'has_cartera', value: 'false', label: 'Sin cartera' },
        { key: 'has_payroll', value: 'false', label: 'Sin nómina' },
        { key: 'max_integrations', value: '1', label: '1 integración' },
        { key: 'storage_months', value: '12', label: '12 meses almacenamiento' },
        { key: 'max_products', value: '100', label: '100 productos' },
        { key: 'bulk_import', value: 'false', label: 'Sin importación masiva' },
        { key: 'has_integrations', value: 'true', label: '1 integración activa' },
        { key: 'max_users', value: '3', label: '3 usuarios' },
      ],
    },
    {
      name: 'EMPRESARIAL',
      displayName: 'Plan Empresarial',
      description: 'Para empresas en crecimiento con necesidades completas',
      price: 249000,
      features: [
        { key: 'max_documents_per_month', value: '2000', label: '2.000 documentos/mes' },
        { key: 'has_invoices', value: 'true', label: 'Todos los documentos DIAN' },
        { key: 'has_inventory', value: 'true', label: 'Inventario completo' },
        { key: 'has_cartera', value: 'true', label: 'Cartera y cobranza' },
        { key: 'has_payroll', value: 'true', label: 'Nómina electrónica' },
        { key: 'max_integrations', value: '5', label: '5 integraciones' },
        { key: 'storage_months', value: '60', label: '5 años almacenamiento' },
        { key: 'max_products', value: '5000', label: '5.000 productos' },
        { key: 'bulk_import', value: 'true', label: 'Importación masiva estándar' },
        { key: 'has_integrations', value: 'true', label: '5 integraciones activas' },
        { key: 'max_users', value: '15', label: '15 usuarios' },
      ],
    },
    {
      name: 'CORPORATIVO',
      displayName: 'Plan Corporativo',
      description: 'Para grandes empresas con volúmenes ilimitados y SLA garantizado',
      price: 749000,
      features: [
        { key: 'max_documents_per_month', value: 'unlimited', label: 'Documentos ilimitados' },
        { key: 'has_invoices', value: 'true', label: 'Todos los documentos DIAN' },
        { key: 'has_inventory', value: 'true', label: 'Inventario avanzado multi-sede' },
        { key: 'has_cartera', value: 'true', label: 'Cartera y cobranza avanzada' },
        { key: 'has_payroll', value: 'true', label: 'Nómina electrónica completa' },
        { key: 'max_integrations', value: 'unlimited', label: 'Integraciones ilimitadas' },
        { key: 'storage_months', value: 'unlimited', label: 'Almacenamiento ilimitado' },
        { key: 'max_products', value: 'unlimited', label: 'Productos ilimitados' },
        { key: 'bulk_import', value: 'true', label: 'Importación masiva avanzada' },
        { key: 'has_integrations', value: 'true', label: 'Integraciones ilimitadas' },
        { key: 'max_users', value: 'unlimited', label: 'Usuarios ilimitados' },
        { key: 'has_sla', value: 'true', label: 'SLA contractual 99.9%' },
        { key: 'has_multicompany', value: 'true', label: 'Multiempresa avanzado' },
        { key: 'priority_support', value: 'true', label: 'Soporte prioritario 24/7' },
      ],
    },
  ];

  for (const planData of plansData) {
    const { features, ...data } = planData;
    const plan = await prisma.plan.upsert({
      where: { name: data.name },
      update: { price: data.price, description: data.description },
      create: data,
    });

    for (const feat of features) {
      await prisma.planFeature.upsert({
        where: { planId_key: { planId: plan.id, key: feat.key } },
        update: { value: feat.value, label: feat.label },
        create: { planId: plan.id, ...feat },
      });
    }
    console.log(`  ✅ Plan: ${plan.displayName}`);
  }

  // ─── SUPER ADMIN ─────────────────────────────────────────────────────────────
  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  const superAdminPassword = await bcrypt.hash('BeccaFact@2025!', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@beccafact.com' },
    update: {},
    create: {
      email: 'superadmin@beccafact.com',
      password: superAdminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      isSuperAdmin: true,
      isActive: true,
    },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: superAdmin.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: superAdmin.id, roleId: superAdminRole.id },
    });
  }
  console.log(`  ✅ Super Admin: ${superAdmin.email}`);

  // ─── EMPRESA DEMO ─────────────────────────────────────────────────────────────
  const empresarialPlan = await prisma.plan.findUnique({ where: { name: 'EMPRESARIAL' } });
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const operatorRole = await prisma.role.findUnique({ where: { name: 'OPERATOR' } });

  const demoCompany = await prisma.company.upsert({
    where: { nit: '900987654-1' },
    update: {},
    create: {
      name: 'Empresa Demo BeccaFact',
      nit: '900987654-1',
      razonSocial: 'EMPRESA DEMO BECCAFACT S.A.S.',
      email: 'demo@empresademo.com',
      phone: '3001234567',
      address: 'Calle 72 # 12-34',
      city: 'Bogotá',
      department: 'Cundinamarca',
      status: 'ACTIVE',
      dianTestMode: true,
    },
  });

  if (empresarialPlan) {
    await prisma.subscription.upsert({
      where: {
        id: (
          await prisma.subscription.findFirst({ where: { companyId: demoCompany.id } })
        )?.id ?? 'nonexistent',
      },
      update: {},
      create: {
        companyId: demoCompany.id,
        planId: empresarialPlan.id,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      },
    });
  }

  // Admin user for demo company
  const adminPassword = await bcrypt.hash('Admin@123456!', 12);
  const demoAdmin = await prisma.user.upsert({
    where: { email: 'admin@empresademo.com' },
    update: {},
    create: {
      email: 'admin@empresademo.com',
      password: adminPassword,
      firstName: 'Carlos',
      lastName: 'Rodríguez',
      companyId: demoCompany.id,
      isActive: true,
    },
  });

  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: demoAdmin.id, roleId: adminRole.id } },
      update: {},
      create: { userId: demoAdmin.id, roleId: adminRole.id },
    });
  }

  // Operator user for demo company
  const operPassword = await bcrypt.hash('Oper@123456!', 12);
  const demoOper = await prisma.user.upsert({
    where: { email: 'operador@empresademo.com' },
    update: {},
    create: {
      email: 'operador@empresademo.com',
      password: operPassword,
      firstName: 'María',
      lastName: 'González',
      companyId: demoCompany.id,
      isActive: true,
    },
  });

  if (operatorRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: demoOper.id, roleId: operatorRole.id } },
      update: {},
      create: { userId: demoOper.id, roleId: operatorRole.id },
    });
  }

  // Demo customers
  const demoCustomers = [
    { documentType: 'NIT', documentNumber: '800200300-5', name: 'Distribuidora Nacional S.A.S.', email: 'compras@distribuidora.com', city: 'Bogotá', creditDays: 30 },
    { documentType: 'NIT', documentNumber: '860001234-2', name: 'Comercializadora del Valle Ltda', email: 'facturas@covalle.com', city: 'Cali', creditDays: 60 },
    { documentType: 'CC', documentNumber: '12345678', name: 'Juan Carlos Pérez Morales', email: 'juan@email.com', city: 'Medellín', creditDays: 0 },
    { documentType: 'NIT', documentNumber: '901234567-3', name: 'Tech Solutions Colombia SAS', email: 'admin@techsol.co', city: 'Bogotá', creditDays: 30 },
  ];

  for (const customer of demoCustomers) {
    await prisma.customer.upsert({
      where: {
        companyId_documentType_documentNumber: {
          companyId: demoCompany.id,
          documentType: customer.documentType as any,
          documentNumber: customer.documentNumber,
        },
      },
      update: {},
      create: { ...customer, companyId: demoCompany.id, documentType: customer.documentType as any },
    });
  }

  // Demo categories
  const categories = ['Tecnología', 'Servicios', 'Papelería', 'Muebles'];
  const createdCategories: Record<string, string> = {};
  for (const catName of categories) {
    const cat = await prisma.category.upsert({
      where: { companyId_name: { companyId: demoCompany.id, name: catName } },
      update: {},
      create: { companyId: demoCompany.id, name: catName },
    });
    createdCategories[catName] = cat.id;
  }

  // Demo products
  const demoProducts = [
    { sku: 'LAP-001', name: 'Laptop Lenovo IdeaPad 15', categoryId: createdCategories['Tecnología'], price: 2500000, cost: 1800000, stock: 15, taxRate: 19 },
    { sku: 'MON-001', name: 'Monitor LG 27" Full HD', categoryId: createdCategories['Tecnología'], price: 850000, cost: 600000, stock: 8, taxRate: 19 },
    { sku: 'SRV-001', name: 'Consultoría Tecnológica (hora)', categoryId: createdCategories['Servicios'], price: 150000, cost: 80000, stock: 0, taxRate: 19 },
    { sku: 'PAP-001', name: 'Resma de Papel Carta x500', categoryId: createdCategories['Papelería'], price: 18000, cost: 12000, stock: 120, taxRate: 19 },
    { sku: 'MUE-001', name: 'Silla Ergonómica Ejecutiva', categoryId: createdCategories['Muebles'], price: 450000, cost: 280000, stock: 25, taxRate: 19 },
    { sku: 'LAP-002', name: 'Laptop HP EliteBook 840 G9', categoryId: createdCategories['Tecnología'], price: 4200000, cost: 3100000, stock: 5, taxRate: 19 },
  ];

  for (const product of demoProducts) {
    await prisma.product.upsert({
      where: { companyId_sku: { companyId: demoCompany.id, sku: product.sku } },
      update: {},
      create: { ...product, companyId: demoCompany.id },
    });
  }

  console.log(`  ✅ Empresa Demo: ${demoCompany.name}`);
  console.log(`  ✅ Admin demo: admin@empresademo.com / Admin@123456!`);
  console.log(`  ✅ Operador demo: operador@empresademo.com / Oper@123456!`);
  console.log(`  ✅ ${demoProducts.length} productos de demo`);
  console.log(`  ✅ ${demoCustomers.length} clientes de demo`);

  console.log('\n🎉 Seed completado exitosamente!\n');
  console.log('📋 Credenciales:');
  console.log('  Super Admin: superadmin@beccafact.com / BeccaFact@2025!');
  console.log('  Admin Demo:  admin@empresademo.com / Admin@123456!');
  console.log('  Operador:    operador@empresademo.com / Oper@123456!');
}

main()
  .catch((e) => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
