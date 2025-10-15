import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function requireSupersu(req, res, next) {
  if (!req.user || req.user.role !== 'SUPERSU') {
    return res.status(403).json({ error: 'Solo SUPERSU' })
  }
  next()
}

export function installCatalogApi(app) {
  // Listar categorías
  app.get('/api/catalog/categories', async (req, res) => {
    const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } })
    res.json(cats)
  })

  // Crear categoría (SUPERSU)
  app.post('/api/catalog/categories', requireSupersu, async (req, res) => {
    const { code, name } = req.body || {}
    if (!code || !name) return res.status(400).json({ error: 'code y name son requeridos' })
    const cat = await prisma.category.create({ data: { code, name } })
    await prisma.auditLog.create({ data: { userCode: req.user.code, module: 'catalog', action: 'category.create', after: JSON.stringify(cat) } })
    res.json(cat)
  })

  // Editar/desactivar categoría (SUPERSU)
  app.patch('/api/catalog/categories/:id', requireSupersu, async (req, res) => {
    const id = Number(req.params.id)
    const before = await prisma.category.findUnique({ where: { id } })
    if (!before) return res.status(404).json({ error: 'No existe' })
    const { name, isActive } = req.body || {}
    const cat = await prisma.category.update({ where: { id }, data: { name, isActive } })
    await prisma.auditLog.create({ data: { userCode: req.user.code, module: 'catalog', action: 'category.update', before: JSON.stringify(before), after: JSON.stringify(cat) } })
    res.json(cat)
  })

  // Listar productos (incluye categoría y presentaciones)
  app.get('/api/catalog/products', async (req, res) => {
    const items = await prisma.product.findMany({
      include: { category: true, presentations: true },
      orderBy: { name: 'asc' }
    })
    res.json(items)
  })

  // Crear producto (SUPERSU)
  app.post('/api/catalog/products', requireSupersu, async (req, res) => {
    const { categoryId, supplierCode, name, controlType, unitName, presentations } = req.body || {}
    if (!categoryId || !supplierCode || !name || !controlType) {
      return res.status(400).json({ error: 'categoryId, supplierCode, name, controlType son requeridos' })
    }
    try {
      const created = await prisma.product.create({
        data: {
          categoryId: Number(categoryId),
          supplierCode,
          name,
          controlType,
          unitName: unitName || null,
          presentations: presentations && Array.isArray(presentations) ? {
            create: presentations.map(p => ({
              name: p.name || 'default',
              unitsPerPack: p.unitsPerPack ?? null,
              bolitasMin: p.bolitasMin ?? null,
              bolitasMax: p.bolitasMax ?? null,
              toppingMaxUses: p.toppingMaxUses ?? null,
              isDefault: !!p.isDefault
            }))
          } : undefined
        },
        include: { category: true, presentations: true }
      })
      await prisma.auditLog.create({ data: { userCode: req.user.code, module: 'catalog', action: 'product.create', after: JSON.stringify(created) } })
      res.json(created)
    } catch (e) {
      res.status(400).json({ error: String(e) })
    }
  })

  // Editar producto (SUPERSU)
  app.patch('/api/catalog/products/:id', requireSupersu, async (req, res) => {
    const id = Number(req.params.id)
    const before = await prisma.product.findUnique({ where: { id }, include: { presentations: true } })
    if (!before) return res.status(404).json({ error: 'No existe' })
    const { name, unitName, isActive } = req.body || {}
    const updated = await prisma.product.update({
      where: { id },
      data: { name, unitName, isActive },
      include: { presentations: true }
    })
    await prisma.auditLog.create({ data: { userCode: req.user.code, module: 'catalog', action: 'product.update', before: JSON.stringify(before), after: JSON.stringify(updated) } })
    res.json(updated)
  })
}
