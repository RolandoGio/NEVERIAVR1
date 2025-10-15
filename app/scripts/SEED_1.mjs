import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function upsertUser(code, name, role) {
  const password = '1234'
  const passwordHash = bcrypt.hashSync(password, 10)
  return prisma.user.upsert({
    where: { code },
    update: { name, role, passwordHash, isActive: true },
    create: { code, name, role, passwordHash, isActive: true }
  })
}

async function main() {
  // Usuarios base
  await upsertUser('SU0001', 'Superusuario', 'SUPERSU')
  await upsertUser('AD0001', 'Administrador', 'ADMIN')
  await upsertUser('CJ0001', 'Cajero', 'CAJERO')

  // Categorías base (si no existen)
  const cats = [
    { code: 'CAT-HEL', name: 'Helados (técnico)' },
    { code: 'CAT-TOP', name: 'Toppings/Jaleas (técnico)' },
    { code: 'CAT-UNI', name: 'Insumos unitarios' },
    { code: 'CAT-VD',  name: 'Venta directa' }
  ]
  for (const c of cats) {
    await prisma.category.upsert({
      where: { code: c.code },
      update: { name: c.name, isActive: true },
      create: { code: c.code, name: c.name }
    })
  }
  console.log('Seed OK: usuarios + categorías base. (pass: 1234)')
}

main().then(() => prisma.$disconnect())
      .catch(e => { console.error(e); process.exit(1) })
