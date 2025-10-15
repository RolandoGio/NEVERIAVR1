// app/src/ReceiptsApp.jsx 
import React, { useEffect, useMemo, useState } from 'react'

const API = 'http://localhost:8787'

// ===== helpers HTTP =====
function authFetch(url, opts = {}) {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('session') ||
    ''
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-session': token,
      ...(opts.headers || {}),
    },
  })
}

/** Parsea JSON y marca 401 como error de auth (sin recargar). */
async function parseJsonOrThrow(resp, ctx = 'solicitud') {
  const ct = (resp.headers.get('content-type') || '').toLowerCase()
  const raw = await resp.text()

  if (!ct.includes('application/json')) {
    const err = new Error(
      resp.status === 401
        ? 'Sesión inválida o expirada'
        : `La API devolvió contenido no-JSON para ${ctx} (HTTP ${resp.status}).\n\nRespuesta corta:\n${raw.slice(0, 180)}`
    )
    err.status = resp.status
    if (resp.status === 401) err.code = 'AUTH'
    throw err
  }

  let j
  try { j = JSON.parse(raw) } catch (e) {
    const err = new Error(`No se pudo interpretar JSON de ${ctx}. ${e.message}`)
    err.status = resp.status
    if (resp.status === 401) err.code = 'AUTH'
    throw err
  }

  if (!resp.ok) {
    const err = new Error(j?.error || `Error en ${ctx} (HTTP ${resp.status})`)
    err.status = resp.status
    if (resp.status === 401) err.code = 'AUTH'
    throw err
  }
  return j
}

// ===== presets locales (fallback por si API falla) =====
const DEFAULT_PRESETS = {
  unlock: [
    'Corrección de conteo',
    'Agregar producto omitido',
    'Eliminar ítem duplicado',
    'Ajuste por devolución',
    'Error de digitación',
  ],
  add_item: [
    'Faltaba en guía',
    'Reposición adicional',
    'Corrección posterior',
    'Ingreso no registrado',
  ],
  delete_item: [
    'Ítem duplicado',
    'Ingreso por error',
    'Producto dañado',
    'Ajuste por diferencia',
  ],
  delete_receipt: [
    'Creada por error',
    'Recepción duplicada',
    'Guía anulada',
    'Se rehará con datos correctos',
  ],
}

// ===== UI chips de comentarios =====
function Chips({ items = [], onPick }) {
  if (!items?.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {items.map((txt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(txt)}
          title={txt}
          style={{
            padding: '4px 8px',
            borderRadius: 999,
            border: '1px solid #2a3f58',
            background: '#122033',
            color: '#cfe6ff',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {txt}
        </button>
      ))}
    </div>
  )
}

// ===== Presentaciones (inyecta opción virtual si no existen) =====
function presentationsFor(p) {
  if (!p) return []
  const list = Array.isArray(p.presentations) ? p.presentations : []
  if (list.length) return list
  if (p.conversionFactor && Number(p.conversionFactor) > 0) {
    return [{
      id: '__CF__',
      name: 'Sin presentación (usa factor del producto)',
      unitsPerPack: Number(p.conversionFactor),
      isDefault: true,
      _virtual: true,
    }]
  }
  return list
}

export default function ReceiptsApp({ onBack }) {
  const [loading, setLoading] = useState(false)
  const [me, setMe] = useState(null)

  const [products, setProducts] = useState([])
  const [receipts, setReceipts] = useState([])
  const [receiptsApiError, setReceiptsApiError] = useState(null)

  // presets
  const [presets, setPresets] = useState(DEFAULT_PRESETS)

  // Flag para cortar el loop si la sesión expiró
  const [authExpired, setAuthExpired] = useState(false)

  // formulario (borrador)
  const [selProductId, setSelProductId] = useState('')
  const [selPresentationId, setSelPresentationId] = useState('')
  const [packs, setPacks] = useState(1)
  const [draftItems, setDraftItems] = useState([])
  const [newComment, setNewComment] = useState('')

  // modales RECEPCIÓN eliminar
  const [delModalOpen, setDelModalOpen] = useState(false)
  const [delComment, setDelComment] = useState('')
  const [receiptToDelete, setReceiptToDelete] = useState(null)

  // modales DESBLOQUEAR
  const [unlockModalOpen, setUnlockModalOpen] = useState(false)
  const [unlockComment, setUnlockComment] = useState('')
  const [receiptToUnlock, setReceiptToUnlock] = useState(null)

  // modales HISTORIAL
  const [histOpen, setHistOpen] = useState(false)
  const [histRows, setHistRows] = useState([])
  const [histFor, setHistFor] = useState(null)

  // modal eliminar ÍTEM
  const [itemDelModalOpen, setItemDelModalOpen] = useState(false)
  const [itemDelComment, setItemDelComment] = useState('')
  const [itemToDelete, setItemToDelete] = useState(null) // { receiptId, itemId, code }

  // modal LOTES por producto
  const [lotsOpen, setLotsOpen] = useState(false)
  const [lotsRows, setLotsRows] = useState([])
  const [lotsTitle, setLotsTitle] = useState('')

  // modal AGREGAR ÍTEM a recepción
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addForReceipt, setAddForReceipt] = useState(null)
  const [addSelProductId, setAddSelProductId] = useState('')
  const [addSelPresentationId, setAddSelPresentationId] = useState('')
  const [addPacks, setAddPacks] = useState(1)
  const [addComment, setAddComment] = useState('')

  const selProduct = useMemo(
    () => products.find(p => String(p.id) === String(selProductId)),
    [products, selProductId]
  )
  const selPresent = useMemo(
    () => presentationsFor(selProduct).find(pr => String(pr.id) === String(selPresentationId)),
    [selProduct, selPresentationId]
  )

  const addSelProduct = useMemo(
    () => products.find(p => String(p.id) === String(addSelProductId)),
    [products, addSelProductId]
  )
  const addSelPresent = useMemo(
    () => presentationsFor(addSelProduct).find(pr => String(pr.id) === String(addSelPresentationId)),
    [addSelProduct, addSelPresentationId]
  )

  const isAdmin = me?.role === 'SUPERSU' || me?.role === 'ADMIN'
  const isCajero = me?.role === 'CAJERO'

  // Manejo centralizado de 401
  function handleAuthError(e) {
    if (e?.status === 401 || e?.code === 'AUTH') {
      try {
        localStorage.removeItem('token')
        localStorage.removeItem('session')
      } catch {}
      setAuthExpired(true)
      setLoading(false)
      return true
    }
    return false
  }

  useEffect(() => {
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshAll() {
    if (authExpired) return
    setLoading(true)
    setReceiptsApiError(null)
    try {
      // quién soy
      const meR = await authFetch(`${API}/api/me`)
      const jMe = await parseJsonOrThrow(meR, 'GET /api/me')
      setMe(jMe.user)

      // productos
      const r1 = await authFetch(`${API}/api/catalog/products`)
      const j1 = await parseJsonOrThrow(r1, 'GET /api/catalog/products')
      setProducts(Array.isArray(j1) ? j1 : (j1.products || []))

      // presets (nuevo endpoint; con fallback)
      try {
        const rp = await authFetch(`${API}/api/receipts/_presets`)
        const jp = await parseJsonOrThrow(rp, 'GET /api/receipts/_presets')
        setPresets({
          unlock: jp.unlock || DEFAULT_PRESETS.unlock,
          add_item: jp.add_item || DEFAULT_PRESETS.add_item,
          delete_item: jp.delete_item || DEFAULT_PRESETS.delete_item,
          delete_receipt: jp.delete_receipt || DEFAULT_PRESETS.delete_receipt,
        })
      } catch {
        // fallback compat: solo unlock
        try {
          const rp2 = await authFetch(`${API}/api/receipts/_unlock_presets`)
          const jp2 = await parseJsonOrThrow(rp2, 'GET /api/receipts/_unlock_presets')
          setPresets(p => ({ ...p, unlock: jp2.presets || DEFAULT_PRESETS.unlock }))
        } catch {}
      }

      // recepciones (vienen con .lot en cada item)
      const r2 = await authFetch(`${API}/api/receipts?limit=30`)
      const j2 = await parseJsonOrThrow(r2, 'GET /api/receipts')
      // a) Ajuste: soportar array plano o { value, receipts }
      setReceipts(Array.isArray(j2) ? j2 : (j2.value || j2.receipts || []))
    } catch (e) {
      if (handleAuthError(e)) return
      if (String(e?.message || '').includes('/api/receipts')) {
        setReceipts([])
        setReceiptsApiError(e.message)
      } else {
        alert(e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  // ===== permisos UI (alineados a backend) =====
  function canEditUI(r) {
    if (!me || !r) return false
    if (isAdmin) return true
    return r.status === 'OPEN' // cajero puede si está abierta (sin “dueño”)
  }
  function canUnlockUI(_r) {
    if (!me) return false
    return isAdmin || isCajero
  }

  // helpers UI
  function fmt(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString()
  }

  function addItemToDraft() {
    if (!selProduct) return alert('Selecciona un producto')
    const pr = selPresent || presentationsFor(selProduct).find(x => x.isDefault) || presentationsFor(selProduct)[0]
    if (!pr) return alert('El producto no tiene presentación')
    const packsNum = Number(packs)
    if (!Number.isFinite(packsNum) || packsNum <= 0) return alert('Packs debe ser mayor a 0')

    setDraftItems(prev => [
      ...prev,
      {
        productId: selProduct.id,
        presentationId: pr._virtual ? null : pr.id, // << enviar null si es “sin presentación”
        packs: packsNum
      },
    ])
  }
  function removeItemFromDraft(idx) {
    setDraftItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ---- CREAR RECEPCIÓN (doble confirm + comentario opcional con presets) ----
  async function createReceipt() {
    if (draftItems.length === 0) return alert('Agrega al menos 1 ítem.')

    const ok1 = window.confirm('¿Estás seguro? ¿Ya revisaste que todos los productos y cantidades estén correctos?')
    if (!ok1) return
    const ok2 = window.confirm('Si continúas, la recepción se CREARÁ CERRADA (LOCKED). Para modificarla después deberás DESBLOQUEAR con justificación. ¿Deseas continuar?')
    if (!ok2) return

    setLoading(true)
    try {
      const r = await authFetch(`${API}/api/receipts`, {
        method: 'POST',
        body: JSON.stringify({ items: draftItems, comment: newComment || '' }),
      })
      const j = await parseJsonOrThrow(r, 'POST /api/receipts')
      alert('Recepción creada (cerrada). Código: ' + (j.code || j.receipt?.code || j?.[0]?.code || ''))
      setDraftItems([])
      setNewComment('')
      setSelProductId('')
      setSelPresentationId('')
      setPacks(1)
      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  function updateItemPacks(rid, itemId, newPacks) {
    setReceipts(prev =>
      prev.map(r => {
        if (r.id !== rid) return r
        return {
          ...r,
          items: r.items.map(it =>
            it.id === itemId ? { ...it, packs: Number(newPacks) } : it
          ),
        }
      })
    )
  }

  // ---- GUARDAR CAMBIOS (confirmar, PUT y luego opción de cerrar) ----
  async function saveChanges(r) {
    if (!canEditUI(r)) return alert('No tienes permiso para editar esta recepción.')

    const ok = window.confirm('¿Guardar los cambios realizados?')
    if (!ok) return

    setLoading(true)
    try {
      const body = {
        items: r.items.map(it => ({
          id: it.id,
          productId: it.productId,
          presentationId: it.presentationId,
          packs: Number(it.packs),
        })),
        comment: '', // opcional
      }
      const rr = await authFetch(`${API}/api/receipts/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      await parseJsonOrThrow(rr, 'PUT /api/receipts/:id')

      if (r.status === 'OPEN') {
        const closeNow = window.confirm('Cambios guardados. ¿Deseas CERRAR (LOCK) la recepción ahora? (Aceptar = cerrar, Cancelar = seguir editando)')
        if (closeNow) {
          try {
            const lockR = await authFetch(`${API}/api/receipts/${r.id}/lock`, { method: 'PATCH' })
            await parseJsonOrThrow(lockR, 'PATCH /api/receipts/:id/lock')
            alert('Recepción cerrada.')
          } catch (e) {
            if (!handleAuthError(e)) alert(e.message)
          }
        } else {
          alert('Cambios guardados. La recepción permanece ABIERTA.')
        }
      } else {
        alert('Cambios guardados.')
      }

      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- DESBLOQUEAR ----
  function openUnlockModal(r) {
    if (!canUnlockUI(r)) return alert('No puedes desbloquear esta recepción.')
    setReceiptToUnlock(r)
    setUnlockComment('')
    setUnlockModalOpen(true)
  }
  async function confirmUnlock() {
    const r = receiptToUnlock
    if (!r) return
    if (isCajero && !unlockComment.trim()) return alert('Debes justificar el desbloqueo.')
    setUnlockModalOpen(false)
    setLoading(true)
    try {
      const resp = await authFetch(`${API}/api/receipts/${r.id}/unlock`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: isCajero ? unlockComment.trim() : '' }), // admin ignora comentario
      })
      await parseJsonOrThrow(resp, 'PATCH /api/receipts/:id/unlock')
      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- CERRAR (LOCK) manual ----
  async function lockReceipt(r) {
    if (!canEditUI({ ...r, status: 'OPEN' }) && !isAdmin) {
      return alert('No tienes permiso para cerrar esta recepción.')
    }
    if (!confirm('Esta acción cerrará la recepción y ya no se podrá editar (a menos que la desbloquees). ¿Continuar?')) return
    setLoading(true)
    try {
      const rr = await authFetch(`${API}/api/receipts/${r.id}/lock`, { method: 'PATCH' })
      await parseJsonOrThrow(rr, 'PATCH /api/receipts/:id/lock')
      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- ELIMINAR RECEPCIÓN ----
  function openDeleteModal(r) {
    const canDelete = canEditUI(r) || isAdmin
    if (!canDelete) return alert('No tienes permiso para eliminar esta recepción.')
    if (!confirm('¿Confirmas que borrar la recepción es lo correcto?')) return
    setReceiptToDelete(r)
    setDelComment('')
    setDelModalOpen(true)
  }
  async function confirmDelete() {
    const r = receiptToDelete
    if (!r) return

    if (!confirm('Esta acción revertirá el stock y borrará la recepción. ¿Deseas continuar?')) return

    if (isCajero && !delComment.trim()) {
      alert('Debes indicar un motivo (comentario) para eliminar la recepción.')
      return
    }

    setDelModalOpen(false)
    setLoading(true)
    try {
      const rr = await authFetch(`${API}/api/receipts/${r.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ comment: isCajero ? delComment.trim() : '' }),
      })
      const jj = await parseJsonOrThrow(rr, 'DELETE /api/receipts/:id')
      if (!jj?.ok) throw new Error(jj?.error || 'No se pudo eliminar la recepción')
      alert('Recepción eliminada')
      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- ELIMINAR ÍTEM ----
  function openItemDeleteModal(receipt, item) {
    if (!canEditUI(receipt) && !isAdmin) {
      return alert('No tienes permiso para eliminar ítems en esta recepción.')
    }
    setItemToDelete({ receiptId: receipt.id, itemId: item.id, code: receipt.code })
    setItemDelComment('')
    setItemDelModalOpen(true)
  }
  async function confirmItemDelete() {
    const ctx = itemToDelete
    if (!ctx) return
    const ok = window.confirm(`¿Eliminar el ítem de la recepción #${ctx.code}?`)
    if (!ok) return

    setItemDelModalOpen(false)
    setLoading(true)
    try {
      const resp = await authFetch(`${API}/api/receipts/${ctx.receiptId}/items/${ctx.itemId}`, {
        method: 'DELETE',
        body: JSON.stringify({ comment: isCajero ? (itemDelComment || '') : '' }),
      })
      const j = await parseJsonOrThrow(resp, 'DELETE /api/receipts/:id/items/:itemId')
      if (!j?.ok) throw new Error('No se pudo eliminar el ítem')
      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- AGREGAR ÍTEM A RECEPCIÓN ----
  function openAddItemModal(r) {
    if (!canEditUI(r)) return alert('No puedes agregar ítems en esta recepción.')
    setAddForReceipt(r)
    setAddModalOpen(true)
    setAddSelProductId('')
    setAddSelPresentationId('')
    setAddPacks(1)
    setAddComment('')
  }
  async function confirmAddItem() {
    if (!addForReceipt) return
    if (!addSelProduct) return alert('Selecciona un producto')
    const pr = addSelPresent || presentationsFor(addSelProduct).find(x => x.isDefault) || presentationsFor(addSelProduct)[0]
    if (!pr) return alert('El producto no tiene presentación')
    const packsNum = Number(addPacks)
    if (!Number.isFinite(packsNum) || packsNum <= 0) return alert('Packs debe ser mayor a 0')

    setAddModalOpen(false)
    setLoading(true)
    try {
      const resp = await authFetch(`${API}/api/receipts/${addForReceipt.id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: addSelProduct.id,
          presentationId: pr._virtual ? null : pr.id, // << enviar null si es virtual
          packs: packsNum,
          comment: isCajero ? (addComment || '') : '',
        }),
      })
      await parseJsonOrThrow(resp, 'POST /api/receipts/:id/items')
      await refreshAll()
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- HISTORIAL ----
  async function openHistory(r) {
    setHistFor(r)
    setHistRows([])
    setHistOpen(true)
    try {
      const resp = await authFetch(`${API}/api/receipts/${r.id}/audit`)
      const j = await parseJsonOrThrow(resp, 'GET /api/receipts/:id/audit')
      setHistRows(j.logs || [])
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    }
  }

  // ---- LOTES POR PRODUCTO ----
  async function openLots(productId, label) {
    setLotsTitle(`Lotes de ${label}`)
    setLotsRows([])
    setLotsOpen(true)
    try {
      const resp = await authFetch(`${API}/api/products/${productId}/lots?limit=30`)
      const j = await parseJsonOrThrow(resp, 'GET /api/products/:id/lots')
      // b) Ajuste: soportar array plano o { value, Count }
      setLotsRows(Array.isArray(j) ? j : (j.value || []))
    } catch (e) {
      if (!handleAuthError(e)) alert(e.message)
    }
  }

  // UI
  return (
    <div style={{ padding: 20 }}>
      <h2>Recepciones</h2>
      <p>
        Las recepciones se crean <b>cerradas (LOCKED)</b> y actualizan stock al instante{' '}
        {isCajero
          ? '· Para editar/eliminar primero debes DESBLOQUEAR (comentario obligatorio).'
          : '· Como ADMIN/SUPERSU puedes editar aun cerradas; se registran auto-comentarios.'}
      </p>

      {receiptsApiError && (
        <div
          style={{
            background: '#3a0e0e',
            border: '1px solid #6b1a1a',
            color: '#ffd6d6',
            padding: 12,
            borderRadius: 10,
            marginBottom: 16,
          }}
        >
          <strong>Atención:</strong> {receiptsApiError}
          <div style={{ opacity: 0.9, marginTop: 6, fontSize: 13 }}>
            Verifica que el backend tenga montado el router de recepciones:
            <code style={{ marginLeft: 6 }}>app.use('/api', auth, receiptsRouter)</code>{' '}
            y que existan los endpoints <code>/api/receipts</code> y <code>/api/receipts/_presets</code>.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* ====== NUEVA RECEPCIÓN ====== */}
        <section style={{ background: '#0f1b2a', padding: 16, borderRadius: 12 }}>
          <h3>Nueva recepción (borrador)</h3>

          <label>Producto</label>
          <select
            value={selProductId}
            onChange={e => {
              setSelProductId(e.target.value)
              const p = products.find(x => String(x.id) === e.target.value)
              const pres = presentationsFor(p)
              const def = pres.find(pp => pp.isDefault) || pres[0]
              setSelPresentationId(def?.id ? String(def.id) : '')
            }}
            style={{ width: '100%', marginBottom: 8 }}
          >
            <option value="">— selecciona —</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.supplierCode} · {p.name} ({p.controlType})
              </option>
            ))}
          </select>

          <label>Presentación</label>
          <select
            value={selPresentationId}
            onChange={e => setSelPresentationId(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
            disabled={!selProduct}
          >
            {presentationsFor(selProduct).map(pr => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
                {typeof pr.unitsPerPack === 'number' ? ` · ${pr.unitsPerPack} u/pack` : ''}
                {typeof pr.bolitasMin === 'number' ? ` · ${pr.bolitasMin}-${pr.bolitasMax} bolitas` : ''}
                {typeof pr.toppingMaxUses === 'number' ? ` · ${pr.toppingMaxUses} usos` : ''}
                {pr.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>

          <label>Packs</label>
          <input
            type="number"
            min="1"
            value={packs}
            onChange={e => setPacks(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />

          <button onClick={addItemToDraft}>Agregar ítem al borrador</button>

          {draftItems.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>Borrador</h4>
              <ul style={{ paddingLeft: 18 }}>
                {draftItems.map((it, i) => {
                  const p = products.find(pp => pp.id === it.productId)
                  const pr = presentationsFor(p).find(x => String(x.id) === String(it.presentationId))
                    || (it.presentationId == null ? { name: 'Sin presentación (usa factor del producto)' } : null)
                  return (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {p?.supplierCode} · {p?.name} — {pr?.name || 'default'} — packs: {it.packs}{' '}
                      <button
                        style={{ marginLeft: 8, fontSize: 12 }}
                        onClick={() => removeItemFromDraft(i)}
                      >
                        Quitar del borrador
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div style={{ marginTop: 10 }}>
                <label>Comentario de creación (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: recepción semanal"
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  style={{ width: '100%', padding: 8 }}
                />
                <small style={{ display: 'block', marginTop: 6, opacity: .85 }}>
                  Si deseas, elige una sugerencia:
                </small>
                <Chips
                  items={presets.add_item}
                  onPick={(txt) => setNewComment(txt)}
                />
              </div>

              <button onClick={createReceipt} disabled={loading} style={{ marginTop: 10 }}>
                Crear recepción (se creará cerrada)
              </button>
            </>
          )}
        </section>

        {/* ====== LISTA DE RECEPCIONES ====== */}
        <section style={{ background: '#0f1b2a', padding: 16, borderRadius: 12 }}>
          <h3>Recepciones recientes</h3>
          {receipts.length === 0 && <p>No hay recepciones.</p>}
          {receipts.map(r => {
            const canEdit = canEditUI(r) // admin siempre true; cajero solo si OPEN
            const canUnlock = canUnlockUI(r) && r.status === 'LOCKED'
            return (
              <div key={r.id} style={{ border: '1px solid #223', padding: 12, borderRadius: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>#{r.code}</strong>
                  <small>{r.status}</small>
                </div>

                {/* Metadatos */}
                <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6, lineHeight: 1.3 }}>
                  <div><b>Creada:</b> {fmt(r.createdAt)} por {r.userCode}</div>
                  <div><b>Últ. mod:</b> {fmt(r.updatedAt)} {r.lastEditedBy ? `por ${r.lastEditedBy}` : ''}</div>
                  {r.comment ? <div><b>Comentario creación:</b> {r.comment}</div> : null}
                  {r.lastEditComment ? <div><b>Último comentario:</b> {r.lastEditComment}</div> : null}
                </div>

                <table style={{ width: '100%', marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Producto</th>
                      <th style={{ textAlign: 'left' }}>Presentación</th>
                      <th style={{ textAlign: 'left' }}>Lote</th>
                      <th style={{ textAlign: 'center', width: 120 }}>Packs</th>
                      <th style={{ textAlign: 'right', width: 260 }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map(it => (
                      <tr key={it.id}>
                        <td>{it.product?.supplierCode} · {it.product?.name}</td>
                        <td>{it.presentation?.name || 'Sin presentación'}</td>
                        <td style={{ fontSize: 12, opacity: 0.9 }}>
                          {it.lot?.code || '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            value={it.packs}
                            onChange={e => updateItemPacks(r.id, it.id, Number(e.target.value))}
                            style={{ width: 100 }}
                            disabled={!canEdit}
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => openItemDeleteModal(r, it)}
                            disabled={!canEdit || loading}
                            style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6', marginRight: 6 }}
                          >
                            Eliminar ítem
                          </button>
                          <button
                            onClick={() =>
                              openLots(
                                it.productId,
                                `${it.product?.supplierCode} · ${it.product?.name}`
                              )
                            }
                            disabled={loading}
                            style={{ background: '#0e2f3a', border: '1px solid #155466' }}
                          >
                            Ver lotes
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <button onClick={() => saveChanges(r)} disabled={!canEdit || loading}>Guardar cambios</button>

                  <button
                    onClick={() => openAddItemModal(r)}
                    disabled={!canEdit || loading}
                    style={{ background: '#15340f', border: '1px solid #2a6d1a', color: '#d8ffd1' }}
                  >
                    Agregar ítem
                  </button>

                  <button
                    onClick={() => openDeleteModal(r)}
                    disabled={(!canEdit && !isAdmin) || loading}
                    style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}
                  >
                    Eliminar recepción
                  </button>

                  <button
                    onClick={() => lockReceipt(r)}
                    disabled={loading || r.status === 'LOCKED'}
                    style={{ background: '#0e2f3a', border: '1px solid #155466' }}
                  >
                    Cerrar (LOCK)
                  </button>

                  <button
                    onClick={() => openUnlockModal(r)}
                    disabled={loading || !canUnlock}
                    style={{ background: '#1b3a0e', border: '1px solid #2e5c15' }}
                  >
                    Desbloquear
                  </button>

                  <button onClick={() => openHistory(r)} disabled={loading}>
                    Ver historial
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={onBack}>← Volver</button>
      </div>

      {loading && <p style={{ opacity: 0.8 }}>Cargando…</p>}

      {/* Modal para ELIMINAR recepción */}
      {delModalOpen && (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h4 style={{ marginTop: 0 }}>Eliminar recepción</h4>
            <p style={{ marginTop: 4, opacity: 0.9 }}>
              {isCajero
                ? 'Indica el motivo. Se revertirá el stock y se borrará la recepción.'
                : 'Se revertirá el stock y se borrará la recepción.'}
            </p>

            {/* Sólo cajero ve chips/entrada */}
            {isCajero && (
              <>
                <Chips
                  items={presets.delete_receipt}
                  onPick={(txt) => setDelComment(txt)}
                />
                <input
                  style={{ width: '100%', padding: 8, marginTop: 8 }}
                  autoFocus
                  value={delComment}
                  onChange={e => setDelComment(e.target.value)}
                  placeholder='Motivo (obligatorio para cajero)'
                />
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setDelModalOpen(false)}>Cancelar</button>
              <button
                onClick={confirmDelete}
                disabled={isCajero && !delComment.trim()}
                style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para DESBLOQUEAR */}
      {unlockModalOpen && (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h4 style={{ marginTop: 0 }}>Desbloquear recepción</h4>

            {/* ADMIN / SUPERSU: solo validación, sin input */}
            {!isCajero ? (
              <>
                <p style={{ marginTop: 4, opacity: 0.9 }}>
                  Se desbloqueará y quedará <b>ABIERTA</b>. Se registrará automáticamente “Desbloqueado por {me?.role}”.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button onClick={() => setUnlockModalOpen(false)}>Cancelar</button>
                  <button onClick={confirmUnlock}>Desbloquear</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginTop: 4, opacity: 0.9, lineHeight: 1.35 }}>
                  Selecciona una justificación rápida o escribe una más específica (obligatorio).
                </p>
                <Chips
                  items={presets.unlock}
                  onPick={(txt) => setUnlockComment(txt)}
                />
                <input
                  style={{ width: '100%', padding: 8, marginTop: 8 }}
                  autoFocus
                  value={unlockComment}
                  onChange={e => setUnlockComment(e.target.value)}
                  placeholder='Motivo de desbloqueo (obligatorio)'
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button onClick={() => setUnlockModalOpen(false)}>Cancelar</button>
                  <button onClick={confirmUnlock} disabled={!unlockComment.trim()}>
                    Desbloquear
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal para ELIMINAR ítem */}
      {itemDelModalOpen && (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h4 style={{ marginTop: 0 }}>Eliminar ítem</h4>
            <p style={{ marginTop: 4, opacity: 0.9 }}>
              Se registrará un ajuste negativo y quedará en bitácora.
            </p>

            {/* Solo cajero ve comentario opcional */}
            {isCajero && (
              <>
                <Chips
                  items={presets.delete_item}
                  onPick={(txt) => setItemDelComment(txt)}
                />
                <input
                  style={{ width: '100%', padding: 8, marginTop: 8 }}
                  autoFocus
                  value={itemDelComment}
                  onChange={e => setItemDelComment(e.target.value)}
                  placeholder='Comentario (opcional)'
                />
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setItemDelModalOpen(false)}>Cancelar</button>
              <button
                onClick={confirmItemDelete}
                style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}
              >
                Eliminar ítem
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal AGREGAR ÍTEM A RECEPCIÓN */}
      {addModalOpen && (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h4 style={{ marginTop: 0 }}>Agregar ítem a #{addForReceipt?.code}</h4>

            <label>Producto</label>
            <select
              value={addSelProductId}
              onChange={e => {
                setAddSelProductId(e.target.value)
                const p = products.find(x => String(x.id) === e.target.value)
                const pres = presentationsFor(p)
                const def = pres.find(pp => pp.isDefault) || pres[0]
                setAddSelPresentationId(def?.id ? String(def.id) : '')
              }}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <option value="">— selecciona —</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.supplierCode} · {p.name}
                </option>
              ))}
            </select>

            <label>Presentación</label>
            <select
              value={addSelPresentationId}
              onChange={e => setAddSelPresentationId(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
              disabled={!addSelProduct}
            >
              {presentationsFor(addSelProduct).map(pr => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}{typeof pr.unitsPerPack === 'number' ? ` · ${pr.unitsPerPack} u/pack` : ''}
                </option>
              ))}
            </select>

            <label>Packs</label>
            <input
              type="number"
              min="1"
              value={addPacks}
              onChange={e => setAddPacks(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
            />

            {/* Solo cajero ve comentario opcional + chips */}
            {isCajero && (
              <>
                <label>Comentario (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: reposición adicional"
                  value={addComment}
                  onChange={e => setAddComment(e.target.value)}
                  style={{ width: '100%', padding: 8, marginBottom: 6 }}
                />
                <Chips items={presets.add_item} onPick={(txt) => setAddComment(txt)} />
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setAddModalOpen(false)}>Cancelar</button>
              <button onClick={confirmAddItem} disabled={!addSelProductId || !addSelPresentationId || Number(addPacks) <= 0}>
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay de sesión expirada (evita el bucle) */}
      {authExpired && (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h4 style={{ marginTop: 0 }}>Sesión expirada</h4>
            <p style={{ marginTop: 4, opacity: 0.9 }}>
              Tu sesión expiró o es inválida. Debes iniciar sesión nuevamente.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={onBack}>Volver</button>
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('token')
                    localStorage.removeItem('session')
                  } catch {}
                  window.location.reload()
                }}
              >
                Reiniciar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal HISTORIAL */}
      {histOpen && (
        <div style={styles.backdrop} onClick={() => setHistOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>Historial #{histFor?.code}</h4>
            <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
              {histRows.length === 0 && <p style={{ opacity: .8 }}>Sin registros recientes.</p>}
              {histRows.map(l => (
                <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #223' }}>
                  <div style={{ fontSize: 13, opacity: .9 }}>
                    <b>{l.action}</b> · {new Date(l.createdAt).toLocaleString()} · por {l.userCode}
                  </div>
                  {l.comment ? <div style={{ fontSize: 13, opacity: .9 }}><i>“{l.comment}”</i></div> : null}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setHistOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal LOTES POR PRODUCTO */}
      {lotsOpen && (
        <div style={styles.backdrop} onClick={() => setLotsOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>{lotsTitle || 'Lotes'}</h4>
            <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
              {lotsRows.length === 0 && <p style={{ opacity: .8 }}>Sin lotes.</p>}
              {lotsRows.length > 0 && (
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Código</th>
                      <th style={{ textAlign: 'left' }}>Estado</th>
                      <th>Total</th>
                      <th>Usado</th>
                      <th>Disponible</th>
                      <th style={{ textAlign: 'left' }}>Recepción</th>
                      <th style={{ textAlign: 'left' }}>Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotsRows.map(l => (
                      <tr key={l.id}>
                        <td>{l.code}</td>
                        <td>{l.status}</td>
                        <td style={{ textAlign: 'right' }}>{l.qtyTotal}</td>
                        <td style={{ textAlign: 'right' }}>{l.qtyUsed}</td>
                        <td style={{ textAlign: 'right' }}>{l.available}</td>
                        <td>{l.receiptCode || '—'}</td>
                        <td>{fmt(l.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setLotsOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
  },
  modal: {
    background: '#0f1b2a', color: '#e5eefc', border: '1px solid #223',
    borderRadius: 12, padding: 16, width: 'min(720px, 92vw)'
  }
}
