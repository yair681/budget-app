import { useState, useEffect, useCallback, useRef } from 'react'
import { createWorker } from 'tesseract.js'
import { requestNotificationPermission, scheduleDailyReminder, cancelDailyReminder, checkWebNotificationTime } from './notifications.js'
import {
  ShoppingCart,
  History,
  TrendingDown,
  AlertCircle,
  Plus,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  Camera,
} from 'lucide-react'

// ─── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'supermarket_budget_v2'

const DEFAULT_STATE = {
  trips: [],
  monthlyBudget: 3000,
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE
  } catch {
    return DEFAULT_STATE
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2)

function fmt(n) {
  const num = Number(n)
  if (isNaN(num)) return '0'
  return num % 1 === 0 ? num.toLocaleString('he-IL') : num.toFixed(2)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

// ─── Category Logic ───────────────────────────────────────────────────────────
const BASICS_WORDS = [
  'חלב','לחם','ביצ','עגב','בצל','גזר','תפוח','אורז','פסטה','קמח','סוכר','מלח','שמן','מים',
  'חמאה','גבינ','יוגורט','קוטג','שמנת','כרוב','חסה','מלפפ','פלפל','שום','לימון','בננ','תפו"א',
]
const LUXURY_WORDS = [
  'יין','בירה','וויסקי','קוניאק','וודקה','אלכוהול','סושי','נקניק','סלמי','פרושוטו','שמפניה',
]

function categorize(name) {
  const lower = (name || '').toLowerCase()
  for (const w of LUXURY_WORDS) {
    if (lower.includes(w)) return 'luxury'
  }
  for (const w of BASICS_WORDS) {
    if (lower.includes(w)) return 'basics'
  }
  return 'convenience'
}

const CAT_LABEL = { basics: 'בסיס', convenience: 'נוחות', luxury: 'מותרות' }
const CAT_COLOR = {
  basics: 'bg-green-900/60 text-green-400 border-green-800',
  convenience: 'bg-orange-900/60 text-orange-400 border-orange-800',
  luxury: 'bg-red-900/60 text-red-400 border-red-800',
}

// ─── Receipt Scanning ─────────────────────────────────────────────────────────
async function scanReceiptImage(imageDataUrl) {
  const worker = await createWorker(['heb', 'eng'], 1, { logger: () => {} })
  const { data: { text } } = await worker.recognize(imageDataUrl)
  await worker.terminate()
  return parseReceiptText(text)
}

function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const products = []
  const priceRegex = /(\d{1,4}[.,]\d{2})/
  const skipWords = ['סה"כ','סכום','מע"מ','הנחה','עודף','שולם','סך','total','vat','change','paid','subtotal','tax','קבלה','חשבונית']

  for (const line of lines) {
    const match = line.match(priceRegex)
    if (!match) continue
    const price = parseFloat(match[1].replace(',', '.'))
    if (price <= 0 || price > 999) continue
    let name = line.replace(match[0], '').replace(/[*×x]/gi, '').replace(/\s{2,}/g, ' ').trim()
    name = name.replace(/^\d+\s*[xX×]\s*/, '').trim()
    if (name.length < 2) continue
    if (skipWords.some(w => name.toLowerCase().includes(w.toLowerCase()))) continue
    products.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name,
      quantity: 1,
      unit: "יח'",
      price,
      category: categorize(name)
    })
  }
  return products
}

// ─── Unit Price Logic ─────────────────────────────────────────────────────────
function unitPrice(price, qty, unit) {
  const p = parseFloat(price) || 0
  const q = parseFloat(qty) || 1
  if (unit === 'גרם') return (p / q) * 1000
  if (unit === 'מ"ל') return (p / q) * 1000
  return p / q
}

function unitPriceLabel(unit) {
  if (unit === 'גרם') return 'לק"ג'
  if (unit === 'מ"ל') return 'לליטר'
  if (unit === 'ק"ג') return 'לק"ג'
  if (unit === 'ל') return 'לליטר'
  return 'ליח\''
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────
function detectAnomalies(trips) {
  // Group all products by normalized name
  const groups = {}
  for (const trip of trips) {
    for (const product of trip.products || []) {
      const key = (product.name || '').toLowerCase().trim()
      if (!key) continue
      if (!groups[key]) groups[key] = []
      groups[key].push({
        price: product.price,
        qty: product.quantity,
        unit: product.unit,
        tripDate: trip.date,
        store: trip.store,
        productName: product.name,
      })
    }
  }

  const anomalies = []
  for (const key of Object.keys(groups)) {
    const entries = groups[key]
    if (entries.length < 2) continue
    for (let i = 0; i < entries.length; i++) {
      const others = entries.filter((_, j) => j !== i)
      const avgPrice = others.reduce((s, e) => s + e.price, 0) / others.length
      const current = entries[i].price
      if (avgPrice > 0 && current > avgPrice * 1.2) {
        const deviation = Math.round(((current - avgPrice) / avgPrice) * 100)
        anomalies.push({
          productName: entries[i].productName,
          currentPrice: current,
          avgPrice,
          deviation,
          tripDate: entries[i].tripDate,
          store: entries[i].store,
        })
      }
    }
  }

  // De-dup by productName+tripDate
  const seen = new Set()
  return anomalies.filter((a) => {
    const key = `${a.productName}__${a.tripDate}__${a.store}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Shared Components ────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-t-3xl w-full max-w-md p-5 pb-10 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-800 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Input({ label, ...props }) {
  return (
    <div>
      {label && <label className="text-xs text-gray-400 mb-1 block">{label}</label>}
      <input
        {...props}
        className={`w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors text-sm ${props.className || ''}`}
      />
    </div>
  )
}

function PrimaryButton({ children, onClick, disabled, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-40 transition-all py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 ${className}`}
    >
      {children}
    </button>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Icon className="w-8 h-8 text-gray-700" />
      </div>
      <p className="text-gray-400 font-medium">{title}</p>
      {subtitle && <p className="text-xs text-gray-600 mt-1">{subtitle}</p>}
    </div>
  )
}

// ─── Category Bar ─────────────────────────────────────────────────────────────
function CategoryBar({ products }) {
  const totals = { basics: 0, convenience: 0, luxury: 0 }
  for (const p of products) {
    totals[p.category] = (totals[p.category] || 0) + (p.price || 0)
  }
  const total = totals.basics + totals.convenience + totals.luxury
  if (total === 0) return null
  return (
    <div className="flex rounded-full overflow-hidden h-1.5 w-full gap-0.5">
      {totals.basics > 0 && (
        <div className="bg-green-500 rounded-full" style={{ width: `${(totals.basics / total) * 100}%` }} />
      )}
      {totals.convenience > 0 && (
        <div className="bg-orange-500 rounded-full" style={{ width: `${(totals.convenience / total) * 100}%` }} />
      )}
      {totals.luxury > 0 && (
        <div className="bg-red-500 rounded-full" style={{ width: `${(totals.luxury / total) * 100}%` }} />
      )}
    </div>
  )
}

// ─── Empty product row factory ────────────────────────────────────────────────
function emptyProduct() {
  return {
    id: generateId(),
    name: '',
    quantity: '',
    unit: 'יח\'',
    price: '',
    category: 'convenience',
  }
}

const UNITS = ['יח\'', 'ק"ג', 'ל', 'גרם', 'מ"ל']

// ─── TAB 1: קנייה ─────────────────────────────────────────────────────────────
function TabShopping({ onSave }) {
  const [date, setDate] = useState(todayISO())
  const [store, setStore] = useState('')
  const [products, setProducts] = useState([emptyProduct()])
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [showCategoryHelp, setShowCategoryHelp] = useState(false)
  const [toast, setToast] = useState('')
  const cameraInputRef = useRef(null)

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleReceiptScan(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)
    try {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        try {
          const extracted = await scanReceiptImage(ev.target.result)
          if (extracted.length === 0) {
            showToast('לא נמצאו מוצרים בקבלה, נסה שוב')
          } else {
            setProducts(prev => [...prev, ...extracted])
            showToast(`נמצאו ${extracted.length} מוצרים מהקבלה ✓`)
          }
        } finally {
          setScanning(false)
          if (cameraInputRef.current) cameraInputRef.current.value = ''
        }
      }
      reader.readAsDataURL(file)
    } catch {
      setScanning(false)
      showToast('שגיאה בניתוח הקבלה')
    }
  }

  const updateProduct = (id, field, value) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const updated = { ...p, [field]: value }
        if (field === 'name') {
          updated.category = categorize(value)
        }
        return updated
      })
    )
  }

  const addProduct = () => setProducts((prev) => [...prev, emptyProduct()])

  const removeProduct = (id) => {
    setProducts((prev) => {
      const filtered = prev.filter((p) => p.id !== id)
      return filtered.length === 0 ? [emptyProduct()] : filtered
    })
  }

  const total = products.reduce((s, p) => s + (parseFloat(p.price) || 0), 0)

  const handleSave = () => {
    if (!store.trim()) { setError('הכנס שם חנות'); return }
    const validProducts = products.filter((p) => p.name.trim() && parseFloat(p.price) > 0)
    if (validProducts.length === 0) { setError('הכנס לפחות מוצר אחד עם שם ומחיר'); return }

    const trip = {
      id: generateId(),
      date,
      store: store.trim(),
      products: validProducts.map((p) => ({
        id: p.id,
        name: p.name.trim(),
        quantity: parseFloat(p.quantity) || 1,
        unit: p.unit,
        price: parseFloat(p.price),
        category: p.category,
      })),
      total,
    }
    onSave(trip)
    setStore('')
    setDate(todayISO())
    setProducts([emptyProduct()])
    setError('')
  }

  return (
    <div className="space-y-4">
      {/* Date + Store */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            label="תאריך"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <Input
            label="חנות"
            type="text"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="שם הסופרמרקט"
          />
        </div>
      </div>

      {/* Product rows header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-500">מוצרים</span>
        <button
          onClick={() => setShowCategoryHelp(true)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span>קטגוריה</span>
          <span className="w-4 h-4 rounded-full bg-gray-700 text-xs text-gray-300 flex items-center justify-center hover:bg-gray-600">?</span>
        </button>
      </div>

      {/* Product rows */}
      <div className="space-y-2">
        {products.map((p, idx) => {
          const up = unitPrice(p.price, p.quantity, p.unit)
          const upLabel = unitPriceLabel(p.unit)
          return (
            <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2">
              {/* Row 1: name + badge */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => updateProduct(p.id, 'name', e.target.value)}
                  onBlur={(e) => updateProduct(p.id, 'category', categorize(e.target.value))}
                  placeholder={`מוצר ${idx + 1}`}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm transition-colors"
                />
                <span className={`text-xs px-2 py-1 rounded-lg border font-medium whitespace-nowrap ${CAT_COLOR[p.category]}`}>
                  {CAT_LABEL[p.category]}
                </span>
              </div>
              {/* Row 2: qty + unit + price + unit price + trash */}
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="decimal"
                  value={p.quantity}
                  onChange={(e) => updateProduct(p.id, 'quantity', e.target.value)}
                  placeholder="כמות"
                  className="w-16 bg-gray-800 border border-gray-700 rounded-xl px-2 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm text-center transition-colors"
                />
                <select
                  value={p.unit}
                  onChange={(e) => updateProduct(p.id, 'unit', e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-xl px-1 py-2 text-white focus:outline-none focus:border-blue-500 text-sm transition-colors"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <div className="relative flex-1">
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">₪</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.price}
                    onChange={(e) => updateProduct(p.id, 'price', e.target.value)}
                    placeholder="מחיר"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl pr-7 pl-2 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm transition-colors"
                  />
                </div>
                {p.price && p.quantity && parseFloat(p.price) > 0 && parseFloat(p.quantity) > 0 ? (
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    ₪{fmt(up)}<br />{upLabel}
                  </span>
                ) : (
                  <span className="w-10" />
                )}
                <button
                  onClick={() => removeProduct(p.id)}
                  className="w-8 h-8 bg-red-950/60 rounded-xl flex items-center justify-center active:scale-95 transition-transform shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add product + Scan receipt */}
      <div className="flex gap-2">
        <button
          onClick={addProduct}
          className="flex-1 border border-dashed border-gray-700 rounded-2xl py-3 text-gray-500 text-sm flex items-center justify-center gap-2 active:scale-95 transition-all hover:border-gray-600 hover:text-gray-400"
        >
          <Plus className="w-4 h-4" />
          הוסף מוצר
        </button>

        {/* hidden camera input */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleReceiptScan}
        />

        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 active:scale-95 transition-all px-4 py-3 rounded-xl text-sm font-semibold"
        >
          <Camera className="w-4 h-4" />
          סרוק קבלה
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-950/60 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Total + Save */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center justify-between">
        <span className="text-gray-400 text-sm">סה"כ</span>
        <span className="text-2xl font-bold text-white">₪{fmt(total)}</span>
      </div>

      <PrimaryButton onClick={handleSave}>
        <ShoppingCart className="w-4 h-4" />
        שמור קנייה
      </PrimaryButton>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 text-white text-sm px-5 py-3 rounded-2xl shadow-xl z-50 whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Scanning overlay */}
      {scanning && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white font-semibold text-lg">מנתח קבלה...</p>
          <p className="text-gray-400 text-sm">אנא המתן</p>
        </div>
      )}

      {/* Category help modal */}
      {showCategoryHelp && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center"
          onClick={() => setShowCategoryHelp(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700/50 rounded-t-3xl w-full max-w-md p-6 pb-10"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-5" />
            <h3 className="text-lg font-bold mb-4">מה כל קטגוריה אומרת?</h3>

            <div className="space-y-4">
              <div className="bg-green-950/50 border border-green-800/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
                  <span className="font-semibold text-green-400">בסיס</span>
                </div>
                <p className="text-sm text-gray-300">מוצרים שחייבים לקנות כל שבוע</p>
                <p className="text-xs text-gray-500 mt-1">חלב, לחם, ביצים, ירקות, פירות, אורז, פסטה, קמח, סוכר, מלח, שמן, מים, חמאה, גבינה, יוגורט</p>
              </div>

              <div className="bg-orange-950/50 border border-orange-800/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />
                  <span className="font-semibold text-orange-400">נוחות</span>
                </div>
                <p className="text-sm text-gray-300">מוצרים שנוח אבל לא חייב</p>
                <p className="text-xs text-gray-500 mt-1">שוקולד, חטיפים, גלידה, אוכל מוכן, קוקה קולה, מיצים, ביסלי, במבה, קפה, תה</p>
              </div>

              <div className="bg-red-950/50 border border-red-800/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
                  <span className="font-semibold text-red-400">מותרות</span>
                </div>
                <p className="text-sm text-gray-300">מוצרים יקרים / לפינוק</p>
                <p className="text-xs text-gray-500 mt-1">יין, בירה, אלכוהול, סושי, נקניקים יקרים, גבינות מיוחדות</p>
              </div>

              <p className="text-xs text-gray-600 text-center">הסיווג נעשה אוטומטית לפי שם המוצר — תוכל לשנות ידנית</p>
            </div>

            <button
              onClick={() => setShowCategoryHelp(false)}
              className="w-full mt-5 bg-gray-800 py-3 rounded-xl font-semibold text-sm active:scale-95"
            >
              הבנתי
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TAB 2: היסטוריה ──────────────────────────────────────────────────────────
function TabHistory({ trips, onDelete }) {
  const [expanded, setExpanded] = useState(null)

  const sorted = [...trips].sort((a, b) => b.date.localeCompare(a.date))

  if (sorted.length === 0) {
    return <EmptyState icon={History} title="אין קניות עדיין" subtitle="הוסף קנייה ראשונה בלשונית 'קנייה'" />
  }

  return (
    <div className="space-y-3">
      {sorted.map((trip) => {
        const isOpen = expanded === trip.id
        return (
          <div key={trip.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            {/* Header */}
            <button
              className="w-full p-4 text-right active:bg-gray-800/50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : trip.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold truncate">{trip.store}</span>
                    <span className="text-xs text-gray-500 shrink-0">{formatDate(trip.date)}</span>
                  </div>
                  <CategoryBar products={trip.products} />
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xl font-bold text-white">₪{fmt(trip.total)}</span>
                    <span className="text-xs text-gray-500">{trip.products.length} מוצרים</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(trip.id) }}
                    className="w-7 h-7 bg-red-950/60 rounded-lg flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </div>
              </div>
            </button>

            {/* Expanded product list */}
            {isOpen && (
              <div className="border-t border-gray-800">
                {trip.products.map((product) => {
                  const up = unitPrice(product.price, product.quantity, product.unit)
                  const upLabel = unitPriceLabel(product.unit)
                  return (
                    <div key={product.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/50 last:border-b-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${CAT_COLOR[product.category]}`}>
                          {CAT_LABEL[product.category]}
                        </span>
                        <span className="text-sm truncate">{product.name}</span>
                        <span className="text-xs text-gray-600 shrink-0">{product.quantity} {product.unit}</span>
                      </div>
                      <div className="flex flex-col items-end shrink-0 mr-2">
                        <span className="text-sm font-medium text-white">₪{fmt(product.price)}</span>
                        <span className="text-xs text-gray-600">₪{fmt(up)} {upLabel}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── TAB 3: ניתוח ─────────────────────────────────────────────────────────────
function TabAnalysis({ trips, monthlyBudget, onBudgetChange }) {
  const now = new Date()
  const thisMonthTrips = trips.filter((t) => {
    const d = new Date(t.date)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  })

  const catTotals = { basics: 0, convenience: 0, luxury: 0 }
  const productMap = {}

  for (const trip of thisMonthTrips) {
    for (const p of trip.products) {
      catTotals[p.category] = (catTotals[p.category] || 0) + p.price
      const key = p.name.toLowerCase().trim()
      if (!productMap[key]) productMap[key] = { name: p.name, total: 0, count: 0 }
      productMap[key].total += p.price
      productMap[key].count += 1
    }
  }

  const monthTotal = catTotals.basics + catTotals.convenience + catTotals.luxury
  const budgetPct = monthlyBudget > 0 ? (monthTotal / monthlyBudget) * 100 : 0

  const top5 = Object.values(productMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const storeFreq = {}
  for (const trip of trips) {
    storeFreq[trip.store] = (storeFreq[trip.store] || 0) + 1
  }
  const topStores = Object.entries(storeFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const progressColor =
    budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-orange-500' : 'bg-green-500'

  return (
    <div className="space-y-4">
      {/* Budget input */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-xs text-gray-400 mb-2">תקציב חודשי (₪)</p>
        <input
          type="number"
          inputMode="decimal"
          value={monthlyBudget}
          onChange={(e) => onBudgetChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-lg font-bold transition-colors"
        />
      </div>

      {/* Budget progress */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">חודש זה</span>
          <span className="text-sm font-semibold">
            ₪{fmt(monthTotal)} / ₪{fmt(monthlyBudget)}
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${progressColor}`}
            style={{ width: `${Math.min(budgetPct, 100)}%` }}
          />
        </div>
        <p className={`text-xs mt-1.5 ${budgetPct >= 100 ? 'text-red-400' : budgetPct >= 80 ? 'text-orange-400' : 'text-green-400'}`}>
          {budgetPct >= 100
            ? `חרגת מהתקציב ב-₪${fmt(monthTotal - monthlyBudget)}`
            : `נשאר ₪${fmt(monthlyBudget - monthTotal)} (${(100 - budgetPct).toFixed(0)}%)`}
        </p>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { key: 'basics', label: 'בסיס', color: 'border-green-800 bg-green-950/40', text: 'text-green-400' },
          { key: 'convenience', label: 'נוחות', color: 'border-orange-800 bg-orange-950/40', text: 'text-orange-400' },
          { key: 'luxury', label: 'מותרות', color: 'border-red-800 bg-red-950/40', text: 'text-red-400' },
        ].map(({ key, label, color, text }) => {
          const amount = catTotals[key]
          const pct = monthTotal > 0 ? ((amount / monthTotal) * 100).toFixed(0) : 0
          return (
            <div key={key} className={`rounded-2xl border p-3 ${color}`}>
              <p className={`text-xs font-medium mb-1 ${text}`}>{label}</p>
              <p className="text-base font-bold text-white">₪{fmt(amount)}</p>
              <p className="text-xs text-gray-500">{pct}%</p>
            </div>
          )
        })}
      </div>

      {/* Top 5 products */}
      {top5.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">5 מוצרים יקרים ביותר החודש</h3>
          <div className="space-y-2">
            {top5.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs w-5 h-5 bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm truncate">{item.name}</span>
                </div>
                <span className="text-sm font-semibold text-white shrink-0 mr-2">₪{fmt(item.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Store frequency */}
      {topStores.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">חנויות נפוצות</h3>
          <div className="space-y-2">
            {topStores.map(([store, count], i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs w-5 h-5 bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">
                    {i + 1}
                  </span>
                  <span className="text-sm">{store}</span>
                </div>
                <span className="text-xs text-gray-500">{count} קניות</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {thisMonthTrips.length === 0 && (
        <EmptyState icon={TrendingDown} title="אין נתונים לחודש זה" subtitle="הוסף קניות כדי לראות ניתוח" />
      )}

      {/* Notification settings */}
      <NotificationCard />
    </div>
  )
}

// ─── Notification Card ────────────────────────────────────────────────────────
function NotificationCard() {
  const [notifEnabled, setNotifEnabled] = useState(() =>
    localStorage.getItem('notifications_enabled') === 'true'
  )

  async function handleNotifToggle() {
    if (notifEnabled) {
      cancelDailyReminder()
      setNotifEnabled(false)
      localStorage.setItem('notifications_enabled', 'false')
    } else {
      const granted = await requestNotificationPermission()
      if (granted) {
        const scheduled = await scheduleDailyReminder()
        if (scheduled) {
          setNotifEnabled(true)
          localStorage.setItem('notifications_enabled', 'true')
        }
      } else {
        alert('לא ניתנה הרשאה להתראות. אנא אפשר הרשאות בהגדרות המכשיר.')
      }
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">תזכורת יומית</p>
          <p className="text-xs text-gray-500 mt-0.5">כל יום ב-20:00 — הכנסת הוצאות</p>
        </div>
        <button
          onClick={handleNotifToggle}
          className={`relative w-12 h-6 rounded-full transition-colors ${notifEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${notifEnabled ? 'right-0.5' : 'left-0.5'}`} />
        </button>
      </div>
    </div>
  )
}

// ─── TAB 4: התראות ────────────────────────────────────────────────────────────
function TabAlerts({ trips }) {
  const anomalies = detectAnomalies(trips)

  if (anomalies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 bg-green-950/60 border border-green-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-green-400" />
        </div>
        <p className="text-green-400 font-semibold">הכל נראה תקין!</p>
        <p className="text-xs text-gray-600 mt-1">לא נמצאו חריגות מחיר</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{anomalies.length} חריגות נמצאו</p>
      {anomalies.map((a, i) => (
        <div key={i} className="bg-red-950/30 border border-red-900/60 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-red-950 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white truncate">{a.productName}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {a.store} · {formatDate(a.tripDate)}
              </p>
              <p className="text-sm text-red-300 mt-2">
                שילמת ₪{fmt(a.currentPrice)} במקום ₪{fmt(a.avgPrice)} בממוצע
              </p>
              <span className="inline-block mt-1.5 text-xs bg-red-950 border border-red-800 text-red-400 px-2 py-0.5 rounded-lg font-semibold">
                +{a.deviation}% מהממוצע
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(loadState)
  const [tab, setTab] = useState('shopping')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    checkWebNotificationTime()
  }, [])

  const handleSaveTrip = useCallback((trip) => {
    setState((prev) => ({ ...prev, trips: [trip, ...prev.trips] }))
    setTab('history')
  }, [])

  const handleDeleteTrip = useCallback((id) => {
    setState((prev) => ({ ...prev, trips: prev.trips.filter((t) => t.id !== id) }))
  }, [])

  const handleBudgetChange = useCallback((val) => {
    setState((prev) => ({ ...prev, monthlyBudget: val }))
  }, [])

  const anomalyCount = detectAnomalies(state.trips).length

  const NAV_TABS = [
    { id: 'shopping', icon: ShoppingCart, label: 'קנייה' },
    { id: 'history', icon: History, label: 'היסטוריה', badge: state.trips.length || null },
    { id: 'analysis', icon: TrendingDown, label: 'ניתוח' },
    { id: 'alerts', icon: AlertCircle, label: 'התראות', badge: anomalyCount || null },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white" dir="rtl">
      {/* Header */}
      <header className="bg-gray-950/90 backdrop-blur border-b border-gray-800/60 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold leading-none">ניהול תקציב סופרמרקט</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {tab === 'shopping' && 'הוסף קנייה חדשה'}
              {tab === 'history' && 'היסטוריית קניות'}
              {tab === 'analysis' && 'ניתוח וסטטיסטיקות'}
              {tab === 'alerts' && 'חריגות מחיר'}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/40">
            <ShoppingCart className="w-4 h-4 text-white" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-md mx-auto px-4 pt-4 pb-28">
        {tab === 'shopping' && (
          <TabShopping onSave={handleSaveTrip} />
        )}
        {tab === 'history' && (
          <TabHistory trips={state.trips} onDelete={handleDeleteTrip} />
        )}
        {tab === 'analysis' && (
          <TabAnalysis
            trips={state.trips}
            monthlyBudget={state.monthlyBudget}
            onBudgetChange={handleBudgetChange}
          />
        )}
        {tab === 'alerts' && (
          <TabAlerts trips={state.trips} />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-950/95 backdrop-blur border-t border-gray-800/60 z-20">
        <div className="flex justify-around max-w-md mx-auto px-1 py-2">
          {NAV_TABS.map(({ id, icon: Icon, label, badge }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-2xl transition-colors relative ${
                tab === id ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge ? (
                  <span className="absolute -top-1.5 -left-1.5 min-w-[16px] h-4 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center font-bold px-0.5">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </div>
              <span className="text-xs font-medium">{label}</span>
              {tab === id && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-400 rounded-full" />
              )}
            </button>
          ))}
        </div>
        <div className="h-safe-area-inset-bottom" />
      </nav>
    </div>
  )
}
