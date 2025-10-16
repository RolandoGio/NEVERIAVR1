import { useEffect, useMemo, useState } from 'react'

const API = 'http://localhost:8787'

function centsToCurrency(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`
}

export default function SalesApp({ token, onBack }) {
  const [products, setProducts] = useState([])
  const [filter, setFilter] = useState('')
  const [cart, setCart] = useState([])
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetch(`${API}/api/catalog/products`, {
          headers: { 'x-session': token },
        })
        const json = await res.json()
        if (res.ok) {
          const list = Array.isArray(json.value) ? json.value : []
          setProducts(list.filter((p) => p.isActive && p.isSellable))
        } else {
          setError(json.error || 'No se pudieron cargar los productos')
        }
      } catch (e) {
        setError(e.message)
      }
    }
    loadProducts()
  }, [token])

  function addToCart(product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.sku === product.supplierCode)
      if (existing) {
        return prev.map((l) =>
          l.sku === product.supplierCode ? { ...l, qty: l.qty + 1 } : l
        )
      }
      return [
        ...prev,
        {
          sku: product.supplierCode,
          name: product.name,
          qty: 1,
          unitPrice: (product.priceSell ?? 0) * 100,
          tags: product.controlType ? [product.controlType] : [],
        },
      ]
    })
  }

  function updateQty(sku, qty) {
    setCart((prev) =>
      prev.map((line) =>
        line.sku === sku ? { ...line, qty: Math.max(0, Number(qty) || 0) } : line
      )
    )
  }

  function removeLine(sku) {
    setCart((prev) => prev.filter((line) => line.sku !== sku))
  }

  async function handleQuote() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/sales/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': token,
        },
        body: JSON.stringify({ cart: { lines: cart } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al cotizar')
      setQuote(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/sales/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': token,
        },
        body: JSON.stringify({ cart: { lines: cart }, comment }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al confirmar')
      alert(`Venta guardada: ${json.sale?.code || 'sin código'}`)
      setCart([])
      setQuote(null)
      setComment('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.supplierCode).toLowerCase().includes(q)
    )
  }, [products, filter])

  const totals = quote?.totals

  return (
    <div className="module">
      <header className="module__header">
        <button onClick={onBack}>← Volver</button>
        <h2>Ventas · POS básico</h2>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <h3>Catálogo vendible</h3>
        <input
          value={filter}
          placeholder="Buscar por nombre o SKU"
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="list">
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              className="list__item"
              onClick={() => addToCart(p)}
            >
              <strong>{p.name}</strong>
              <small>{p.supplierCode}</small>
            </button>
          ))}
          {!filteredProducts.length && <p>No hay productos</p>}
        </div>
      </section>

      <section className="panel">
        <h3>Carrito</h3>
        {cart.map((line) => (
          <div key={line.sku} className="cart-line">
            <div>
              <strong>{line.name}</strong>
              <small>{line.sku}</small>
            </div>
            <input
              type="number"
              min={0}
              value={line.qty}
              onChange={(e) => updateQty(line.sku, e.target.value)}
            />
            <button onClick={() => removeLine(line.sku)}>✕</button>
          </div>
        ))}
        {!cart.length && <p>Sin productos en carrito.</p>}
      </section>

      <section className="panel">
        <h3>Acciones</h3>
        <textarea
          placeholder="Comentario opcional"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="actions">
          <button onClick={handleQuote} disabled={!cart.length || loading}>
            Cotizar
          </button>
          <button onClick={handleCommit} disabled={!cart.length || loading}>
            Confirmar venta
          </button>
        </div>
        {loading && <p>Procesando…</p>}
        {totals && (
          <div className="totals">
            <p>Bruto: {centsToCurrency(totals.totalGross)}</p>
            <p>Descuento: {centsToCurrency(totals.totalDiscount)}</p>
            <p>Total: {centsToCurrency(totals.totalNet)}</p>
          </div>
        )}
        {quote?.applied?.length ? (
          <div className="applied">
            <h4>Promociones aplicadas</h4>
            <ul>
              {quote.applied.map((promo) => (
                <li key={promo.id || promo.name}>
                  {promo.name || promo.id} · {promo.type}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
