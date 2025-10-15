import React, { useEffect, useState } from 'react'

const API = 'http://localhost:8787'

function authFetch(url, opts = {}) {
  const token = localStorage.getItem('token') || localStorage.getItem('session') || ''
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-session': token,
      ...(opts.headers || {}),
    },
  })
}

export default function CatalogApp({ onBack }) {
  const [cats, setCats] = useState([])
  const [formCat, setFormCat] = useState({ code: '', name: '' })
  const [prods, setProds] = useState([])
  const [formProd, setFormProd] = useState({
    categoryId: '',
    supplierCode: '',
    name: '',
    controlType: 'unitario',
    unitName: 'unidad',
    pres: { name: 'default', unitsPerPack: 1, bolitasMin: '', bolitasMax: '', toppingMaxUses: '', isDefault: true }
  })
  const [msg, setMsg] = useState('')

  async function fetchCats() {
    const r = await authFetch(`${API}/api/catalog/categories`)
    if (r.status === 401) { alert('Sesión expirada'); onBack?.(); return }
    const j = await r.json()
    setCats(Array.isArray(j) ? j : (j.categories || []))
  }

  async function fetchProds() {
    const r = await authFetch(`${API}/api/catalog/products`)
    if (r.status === 401) { alert('Sesión expirada'); onBack?.(); return }
    const j = await r.json()
    setProds(Array.isArray(j) ? j : (j.products || []))
  }

  useEffect(() => { fetchCats(); fetchProds() }, [])

  async function createCat(e) {
    e.preventDefault()
    setMsg('Creando categoría...')
    const r = await authFetch(`${API}/api/catalog/categories`, {
      method: 'POST',
      body: JSON.stringify(formCat),
    })
    const j = await r.json()
    if (r.ok) {
      setMsg('Categoría creada')
      setFormCat({ code: '', name: '' })
      fetchCats()
    } else {
      if (r.status === 401) { alert('Sesión expirada'); onBack?.(); return }
      setMsg(j.error || 'Error')
    }
  }

  async function createProd(e) {
    e.preventDefault()
    setMsg('Creando producto...')

    const payload = {
      categoryId: Number(formProd.categoryId),
      supplierCode: formProd.supplierCode.trim(),
      name: formProd.name.trim(),
      controlType: formProd.controlType,
      unitName: (formProd.controlType === 'unitario' || formProd.controlType === 'venta_directa')
        ? (formProd.unitName || 'unidad')
        : null,
      presentations: [{
        name: formProd.pres.name || 'default',
        unitsPerPack: formProd.controlType === 'unitario'
          ? Number(formProd.pres.unitsPerPack || 1)
          : undefined,
        bolitasMin: formProd.controlType === 'tecnico_helado'
          ? Number(formProd.pres.bolitasMin || 0)
          : undefined,
        bolitasMax: formProd.controlType === 'tecnico_helado'
          ? Number(formProd.pres.bolitasMax || 0)
          : undefined,
        toppingMaxUses: formProd.controlType === 'tecnico_topping'
          ? Number(formProd.pres.toppingMaxUses || 0)
          : undefined,
        isDefault: true
      }]
    }

    const r = await authFetch(`${API}/api/catalog/products`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const j = await r.json()
    if (r.ok) {
      setMsg('Producto creado')
      fetchProds()
    } else {
      if (r.status === 401) { alert('Sesión expirada'); onBack?.(); return }
      setMsg(j.error || 'Error')
    }
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, Arial', padding: 24, color: '#e5eefc' }}>
      <h1>Catálogo Maestro — SUPERSU</h1>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: '#0f1a33', padding: 16, borderRadius: 8 }}>
          <h2>Nueva categoría</h2>
          <form onSubmit={createCat}>
            <label>Código</label>
            <input value={formCat.code} onChange={e => setFormCat({ ...formCat, code: e.target.value })} style={{ width: '100%', padding: 8 }} />
            <label style={{ marginTop: 8, display: 'block' }}>Nombre</label>
            <input value={formCat.name} onChange={e => setFormCat({ ...formCat, name: e.target.value })} style={{ width: '100%', padding: 8 }} />
            <button style={{ marginTop: 10 }}>Crear</button>
          </form>
          <h3 style={{ marginTop: 16 }}>Categorías</h3>
          <ul>{cats.map(c => (<li key={c.id}>{c.code} — {c.name} {c.isActive ? '' : '(inactiva)'}</li>))}</ul>
        </div>

        <div style={{ background: '#0f1a33', padding: 16, borderRadius: 8 }}>
          <h2>Nuevo producto</h2>
          <form onSubmit={createProd}>
            <label>Categoría</label>
            <select value={formProd.categoryId} onChange={e => setFormProd({ ...formProd, categoryId: e.target.value })} style={{ width: '100%', padding: 8 }}>
              <option value="">-- selecciona --</option>
              {cats.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>

            <label style={{ marginTop: 8, display: 'block' }}>Código proveedor</label>
            <input value={formProd.supplierCode} onChange={e => setFormProd({ ...formProd, supplierCode: e.target.value })} style={{ width: '100%', padding: 8 }} />

            <label style={{ marginTop: 8, display: 'block' }}>Nombre</label>
            <input value={formProd.name} onChange={e => setFormProd({ ...formProd, name: e.target.value })} style={{ width: '100%', padding: 8 }} />

            <label style={{ marginTop: 8, display: 'block' }}>Tipo de control</label>
            <select value={formProd.controlType} onChange={e => setFormProd({ ...formProd, controlType: e.target.value })} style={{ width: '100%', padding: 8 }}>
              <option value="unitario">unitario</option>
              <option value="venta_directa">venta_directa</option>
              <option value="tecnico_helado">tecnico_helado</option>
              <option value="tecnico_topping">tecnico_topping</option>
            </select>

            {(formProd.controlType === 'unitario' || formProd.controlType === 'venta_directa') && (
              <>
                <label style={{ marginTop: 8, display: 'block' }}>Unidad</label>
                <input value={formProd.unitName} onChange={e => setFormProd({ ...formProd, unitName: e.target.value })} style={{ width: '100%', padding: 8 }} />
              </>
            )}

            <h3 style={{ marginTop: 8 }}>Presentación (default)</h3>
            {formProd.controlType === 'unitario' && (
              <>
                <label>Unidades por pack/caja</label>
                <input
                  type="number"
                  value={formProd.pres.unitsPerPack}
                  onChange={e => setFormProd({ ...formProd, pres: { ...formProd.pres, unitsPerPack: e.target.value } })}
                  style={{ width: '100%', padding: 8 }}
                />
              </>
            )}
            {formProd.controlType === 'tecnico_helado' && (
              <>
                <label>Bolitas mín</label>
                <input
                  type="number"
                  value={formProd.pres.bolitasMin}
                  onChange={e => setFormProd({ ...formProd, pres: { ...formProd.pres, bolitasMin: e.target.value } })}
                  style={{ width: '100%', padding: 8 }}
                />
                <label>Bolitas máx</label>
                <input
                  type="number"
                  value={formProd.pres.bolitasMax}
                  onChange={e => setFormProd({ ...formProd, pres: { ...formProd.pres, bolitasMax: e.target.value } })}
                  style={{ width: '100%', padding: 8 }}
                />
              </>
            )}
            {formProd.controlType === 'tecnico_topping' && (
              <>
                <label>Usos máximos por envase</label>
                <input
                  type="number"
                  value={formProd.pres.toppingMaxUses}
                  onChange={e => setFormProd({ ...formProd, pres: { ...formProd.pres, toppingMaxUses: e.target.value } })}
                  style={{ width: '100%', padding: 8 }}
                />
              </>
            )}

            <button style={{ marginTop: 10 }}>Crear producto</button>
          </form>
        </div>
      </section>

      <div style={{ marginTop: 16 }}>{msg}</div>

      <section style={{ marginTop: 24 }}>
        <h2>Productos</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Proveedor</th><th style={{ textAlign: 'left' }}>Nombre</th><th>Categoría</th><th>Tipo</th><th>Presentaciones</th></tr>
          </thead>
          <tbody>
            {prods.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid #213' }}>
                <td>{p.supplierCode}</td>
                <td>{p.name}</td>
                <td>{p.category?.name}</td>
                <td>{p.controlType}</td>
                <td>
                  {p.presentations?.map(pr => (
                    <div key={pr.id}>
                      {pr.name}
                      {pr.unitsPerPack ? ` · ${pr.unitsPerPack} u/pack` : ''}
                      {pr.bolitasMin ? ` · ${pr.bolitasMin}-${pr.bolitasMax} bolitas` : ''}
                      {pr.toppingMaxUses ? ` · ${pr.toppingMaxUses} usos` : ''}
                      {pr.isDefault ? ' · default' : ''}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 16 }}>
          <button onClick={onBack}>← Volver</button>
        </div>
      </section>
    </div>
  )
}
