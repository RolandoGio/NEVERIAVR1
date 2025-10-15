import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(code, name, role) {
  const passwordHash = bcrypt.hashSync('1234', 10);
  return prisma.user.upsert({
    where: { code },
    update: { name, role, passwordHash, isActive: true },
    create: { code, name, role, passwordHash, isActive: true },
  });
} // <--- ¡ojo! cierre de función

async function upsertCategory(code, name) {
  return prisma.category.upsert({
    where: { code },
    update: { name, isActive: true },
    create: { code, name },
  });
}

async function getCategoryId(code) {
  const c = await prisma.category.findUnique({ where: { code } });
  if (!c) throw new Error(`No existe la categoría ${code}`);
  return c.id;
}

async function main() {
  // Usuarios
  await upsertUser('SU0001', 'Superusuario', 'SUPERSU');
  await upsertUser('AD0001', 'Administrador', 'ADMIN');
  await upsertUser('CJ0001', 'Cajero', 'CAJERO');

  // Categorías
  await upsertCategory('CAT-HEL', 'Helados (técnico)');
  await upsertCategory('CAT-TOP', 'Toppings/Jaleas (técnico)');
  await upsertCategory('CAT-UNI', 'Insumos unitarios');
  await upsertCategory('CAT-VD',  'Venta directa');

  // Ids de categorías
  const catHel = await getCategoryId('CAT-HEL');
  const catTop = await getCategoryId('CAT-TOP');
  const catUni = await getCategoryId('CAT-UNI');
  const catVD  = await getCategoryId('CAT-VD');

  // Productos demo (ahora sí se puede upsert por supplierCode porque es único)
  await prisma.product.upsert({
    where: { supplierCode: 'HEL-VAIN' },
    update: {},
    create: {
      categoryId: catHel,
      supplierCode: 'HEL-VAIN',
      name: 'Helado Vainilla',
      controlType: 'tecnico_helado',
      isActive: true,
      presentations: {
        create: [{
          name: 'cubeta 4L',
          bolitasMin: 130,
          bolitasMax: 150,
          isDefault: true,
          isActive: true,
        }],
      },
    },
  });

  await prisma.product.upsert({
    where: { supplierCode: 'TOP-CHOCO' },
    update: {},
    create: {
      categoryId: catTop,
      supplierCode: 'TOP-CHOCO',
      name: 'Topping Chocolate',
      controlType: 'tecnico_topping',
      isActive: true,
      presentations: {
        create: [{
          name: 'frasco 1L',
          toppingMaxUses: 60,
          isDefault: true,
          isActive: true,
        }],
      },
    },
  });

  await prisma.product.upsert({
    where: { supplierCode: 'CN-360' },
    update: {},
    create: {
      categoryId: catUni,
      supplierCode: 'CN-360',
      name: 'Conos (caja 360 u)',
      controlType: 'unitario',
      unitName: 'unidad',
      isActive: true,
      presentations: {
        create: [{
          name: 'caja',
          unitsPerPack: 360,
          isDefault: true,
          isActive: true,
        }],
      },
    },
  });

  await prisma.product.upsert({
    where: { supplierCode: 'PAST-REB' },
    update: {},
    create: {
      categoryId: catVD,
      supplierCode: 'PAST-REB',
      name: 'Pastel — rebanada',
      controlType: 'venta_directa',
      unitName: 'pieza',
      isActive: true,
      presentations: {
        create: [{
          name: 'default',
          isDefault: true,
          isActive: true,
        }],
      },
    },
  });

  console.log('Seed OK: usuarios + categorías + productos de ejemplo (pass: 1234)');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error('Seed ERROR:', e); process.exit(1); });
