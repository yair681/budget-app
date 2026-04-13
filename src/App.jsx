import { useState, useEffect, useCallback } from 'react'
import {
  Wallet,
  PiggyBank,
  ShoppingCart,
  ArrowRightLeft,
  Plus,
  Trash2,
  X,
  Check,
  Receipt,
  TrendingDown,
  AlertCircle,
  History,
  Pencil,
  ChevronDown,
} from 'lucide-react'

// ─── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'hadrshot_budget_v1'

const DEFAULT_STATE = {
  bankBalance: 0,
  savingsBalance: 0,
  weeklyBudget: 0,
  debts: [],
  expenses: [],
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
function fmt(n) {
  return Number(n).toLocaleString('he-IL')
}

function today() {
  return new Date().toLocaleDateString('he-IL')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BalanceCard({ label, value, gradient, border, icon: Icon, iconBg, onEdit, badge }) {
  return (
    <div
      className={`rounded-2xl p-5 border ${gradient} ${border} cursor-pointer select-none`}
      onClick={onEdit}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-medium opacity-80">{label}</span>
        </div>
        <div className="flex items-center gap-1 opacity-60 text-xs">
          <Pencil className="w-3 h-3" />
          <span>ערוך</span>
        </div>
      </div>
      <div className="text-4xl font-bold tracking-tight">₪{fmt(value)}</div>
      {badge && <div className="mt-2 text-xs opacity-60">{badge}</div>}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700/50 rounded-t-3xl w-full max-w-md p-6 pb-10">
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-between mb-6">
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

function CenterModal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700/50 rounded-3xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-6">
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
      {label && <label className="text-sm text-gray-400 mb-1.5 block">{label}</label>}
      <input
        {...props}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  )
}

function PrimaryButton({ children, onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`w-full bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all py-3.5 rounded-xl font-semibold text-sm ${className}`}
    >
      {children}
    </button>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState(loadState)
  const [tab, setTab] = useState('dashboard')

  // Modals
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [debtOpen, setDebtOpen] = useState(false)
  const [editField, setEditField] = useState(null) // 'bankBalance' | 'savingsBalance'

  // Forms
  const [expenseForm, setExpenseForm] = useState({ name: '', amount: '' })
  const [debtForm, setDebtForm] = useState({ name: '', amount: '', note: '' })
  const [editValue, setEditValue] = useState('')

  // Feedback
  const [transferDone, setTransferDone] = useState(false)
  const [error, setError] = useState('')

  // Persist to localStorage on every state change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const showError = (msg) => {
    setError(msg)
    setTimeout(() => setError(''), 2500)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleWeeklyTransfer = useCallback(() => {
    if (state.bankBalance < 100) {
      showError('אין מספיק כסף בעובר ושב (דרוש ₪100)')
      return
    }
    setState((prev) => ({
      ...prev,
      bankBalance: prev.bankBalance - 100,
      weeklyBudget: prev.weeklyBudget + 100,
    }))
    setTransferDone(true)
    setTimeout(() => setTransferDone(false), 2000)
  }, [state.bankBalance])

  const handleAddExpense = () => {
    const amount = parseFloat(expenseForm.amount)
    if (!expenseForm.name.trim() || !amount || amount <= 0) {
      showError('מלא שם וסכום תקין')
      return
    }
    if (state.weeklyBudget < amount) {
      showError('אין מספיק בתקציב השבועי!')
      return
    }
    setState((prev) => ({
      ...prev,
      weeklyBudget: prev.weeklyBudget - amount,
      expenses: [
        { id: Date.now(), name: expenseForm.name.trim(), amount, date: today() },
        ...prev.expenses,
      ],
    }))
    setExpenseForm({ name: '', amount: '' })
    setExpenseOpen(false)
  }

  const handleAddDebt = () => {
    const amount = parseFloat(debtForm.amount)
    if (!debtForm.name.trim() || !amount || amount <= 0) {
      showError('מלא שם וסכום תקין')
      return
    }
    setState((prev) => ({
      ...prev,
      debts: [
        {
          id: Date.now(),
          name: debtForm.name.trim(),
          amount,
          note: debtForm.note.trim(),
          date: today(),
        },
        ...prev.debts,
      ],
    }))
    setDebtForm({ name: '', amount: '', note: '' })
    setDebtOpen(false)
  }

  const handleDeleteDebt = (id) => {
    setState((prev) => ({ ...prev, debts: prev.debts.filter((d) => d.id !== id) }))
  }

  const handleMarkDebtPaid = (id) => {
    setState((prev) => ({ ...prev, debts: prev.debts.filter((d) => d.id !== id) }))
  }

  const handleEditBalance = () => {
    const val = parseFloat(editValue)
    if (isNaN(val) || val < 0) {
      showError('הכנס מספר תקין')
      return
    }
    setState((prev) => ({ ...prev, [editField]: val }))
    setEditField(null)
    setEditValue('')
  }

  const openEdit = (field, current) => {
    setEditField(field)
    setEditValue(String(current))
  }

  const totalDebts = state.debts.reduce((s, d) => s + d.amount, 0)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white" dir="rtl">

      {/* ── Header ── */}
      <header className="bg-gray-950/90 backdrop-blur border-b border-gray-800/60 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div>
            <h1 className="text-lg font-bold leading-none">ניהול תקציב</h1>
            <p className="text-xs text-gray-500 mt-0.5">עסק הדרשיות</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/40">
            <span className="text-sm font-bold">י</span>
          </div>
        </div>
      </header>

      {/* ── Error Toast ── */}
      {error && (
        <div className="fixed top-16 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-red-900/90 border border-red-700 rounded-2xl px-4 py-3 text-sm text-red-200 flex items-center gap-2 shadow-xl">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        </div>
      )}

      {/* ── Main ── */}
      <main className="max-w-md mx-auto px-4 pb-28 pt-4">

        {/* ════ DASHBOARD TAB ════ */}
        {tab === 'dashboard' && (
          <div className="space-y-3">

            {/* Bank */}
            <BalanceCard
              label="עובר ושב בבנק"
              value={state.bankBalance}
              gradient="bg-gradient-to-br from-blue-950 to-blue-900"
              border="border-blue-800/50"
              icon={Wallet}
              iconBg="bg-blue-700"
              onEdit={() => openEdit('bankBalance', state.bankBalance)}
            />

            {/* Savings */}
            <BalanceCard
              label="פיקדון לרשיון"
              value={state.savingsBalance}
              gradient="bg-gradient-to-br from-violet-950 to-violet-900"
              border="border-violet-800/50"
              icon={PiggyBank}
              iconBg="bg-violet-700"
              onEdit={() => openEdit('savingsBalance', state.savingsBalance)}
            />

            {/* Weekly Budget */}
            <div className="bg-gradient-to-br from-emerald-950 to-emerald-900 rounded-2xl p-5 border border-emerald-800/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 bg-emerald-700 rounded-xl flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-medium opacity-80">תקציב שבועי</span>
              </div>
              <div className="text-4xl font-bold tracking-tight mb-5">₪{fmt(state.weeklyBudget)}</div>

              {/* Transfer button */}
              <button
                onClick={handleWeeklyTransfer}
                className={`w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 ${
                  transferDone
                    ? 'bg-green-600 text-white'
                    : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                }`}
              >
                {transferDone ? (
                  <><Check className="w-4 h-4" /> הועבר ₪100 בהצלחה!</>
                ) : (
                  <><ArrowRightLeft className="w-4 h-4" /> העברה שבועית — ₪100</>
                )}
              </button>

              {/* Expense button */}
              <button
                onClick={() => setExpenseOpen(true)}
                className="w-full mt-2 py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-gray-800/80 hover:bg-gray-800 active:scale-95 border border-gray-700/50 transition-all"
              >
                <TrendingDown className="w-4 h-4 text-red-400" />
                הוסף הוצאה מהירה
              </button>
            </div>

            {/* Recent Expenses */}
            {state.expenses.length > 0 && (
              <div className="pt-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">הוצאות אחרונות</h2>
                <div className="space-y-2">
                  {state.expenses.slice(0, 6).map((exp) => (
                    <div
                      key={exp.id}
                      className="bg-gray-900 border border-gray-800/60 rounded-2xl px-4 py-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-red-950 rounded-xl flex items-center justify-center shrink-0">
                          <Receipt className="w-4 h-4 text-red-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{exp.name}</p>
                          <p className="text-xs text-gray-600">{exp.date}</p>
                        </div>
                      </div>
                      <span className="text-red-400 font-semibold text-sm">−₪{fmt(exp.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ DEBTS TAB ════ */}
        {tab === 'debts' && (
          <div>
            {/* Header row */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold">חובות</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  סה"כ מגיע לך:{' '}
                  <span className="text-green-400 font-bold">₪{fmt(totalDebts)}</span>
                </p>
              </div>
              <button
                onClick={() => setDebtOpen(true)}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all px-4 py-2.5 rounded-xl text-sm font-semibold"
              >
                <Plus className="w-4 h-4" />
                הוסף
              </button>
            </div>

            {state.debts.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-gray-700" />
                </div>
                <p className="text-gray-500 font-medium">אין חובות ברשימה</p>
                <p className="text-xs text-gray-700 mt-1">לחץ "הוסף" כדי להוסיף חוב</p>
              </div>
            ) : (
              <div className="space-y-3">
                {state.debts.map((debt) => (
                  <div
                    key={debt.id}
                    className="bg-gray-900 border border-gray-800/60 rounded-2xl p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{debt.name}</p>
                        {debt.note && (
                          <p className="text-sm text-gray-500 mt-0.5 truncate">{debt.note}</p>
                        )}
                        <p className="text-xs text-gray-700 mt-1.5">{debt.date}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-green-400 font-bold text-lg">₪{fmt(debt.amount)}</span>
                        <button
                          onClick={() => handleMarkDebtPaid(debt.id)}
                          className="w-8 h-8 bg-green-900/50 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
                          title="סמן כשולם"
                        >
                          <Check className="w-4 h-4 text-green-400" />
                        </button>
                        <button
                          onClick={() => handleDeleteDebt(debt.id)}
                          className="w-8 h-8 bg-red-950 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
                          title="מחק"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ HISTORY TAB ════ */}
        {tab === 'history' && (
          <div>
            <h2 className="text-lg font-bold mb-5">היסטוריית הוצאות</h2>
            {state.expenses.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <History className="w-8 h-8 text-gray-700" />
                </div>
                <p className="text-gray-500 font-medium">אין הוצאות עדיין</p>
              </div>
            ) : (
              <div className="space-y-2">
                {state.expenses.map((exp) => (
                  <div
                    key={exp.id}
                    className="bg-gray-900 border border-gray-800/60 rounded-2xl px-4 py-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-red-950 rounded-xl flex items-center justify-center shrink-0">
                        <Receipt className="w-4 h-4 text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{exp.name}</p>
                        <p className="text-xs text-gray-600">{exp.date}</p>
                      </div>
                    </div>
                    <span className="text-red-400 font-semibold text-sm">−₪{fmt(exp.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Bottom Navigation ── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-950/95 backdrop-blur border-t border-gray-800/60 z-10">
        <div className="flex justify-around max-w-md mx-auto px-2 py-2">
          {[
            { id: 'dashboard', icon: Wallet, label: 'דשבורד' },
            { id: 'debts', icon: AlertCircle, label: 'חובות', badge: state.debts.length || null },
            { id: 'history', icon: History, label: 'היסטוריה' },
          ].map(({ id, icon: Icon, label, badge }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-1 py-2 px-6 rounded-2xl transition-colors relative ${
                tab === id ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
              {badge ? (
                <span className="absolute top-1.5 right-3.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {/* iPhone safe area */}
        <div className="h-safe-area-inset-bottom" />
      </nav>

      {/* ══ MODAL: Add Expense ══ */}
      {expenseOpen && (
        <Modal title="הוצאה מהירה" onClose={() => setExpenseOpen(false)}>
          <div className="space-y-4">
            <Input
              label="שם ההוצאה"
              type="text"
              value={expenseForm.name}
              onChange={(e) => setExpenseForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="למשל: אוכל, תחבורה, חבר..."
              autoFocus
            />
            <Input
              label="סכום (₪)"
              type="number"
              inputMode="decimal"
              value={expenseForm.amount}
              onChange={(e) => setExpenseForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder="0"
            />
            <div className="text-xs text-gray-500 text-center">
              תקציב זמין: <span className="text-emerald-400 font-semibold">₪{fmt(state.weeklyBudget)}</span>
            </div>
            <PrimaryButton onClick={handleAddExpense}>הוסף הוצאה</PrimaryButton>
          </div>
        </Modal>
      )}

      {/* ══ MODAL: Add Debt ══ */}
      {debtOpen && (
        <Modal title="הוסף חוב" onClose={() => setDebtOpen(false)}>
          <div className="space-y-4">
            <Input
              label="שם החייב"
              type="text"
              value={debtForm.name}
              onChange={(e) => setDebtForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="מי חייב לך כסף?"
              autoFocus
            />
            <Input
              label="סכום (₪)"
              type="number"
              inputMode="decimal"
              value={debtForm.amount}
              onChange={(e) => setDebtForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder="0"
            />
            <Input
              label="הערה (אופציונלי)"
              type="text"
              value={debtForm.note}
              onChange={(e) => setDebtForm((p) => ({ ...p, note: e.target.value }))}
              placeholder="בשביל מה? שיעור, הלוואה..."
            />
            <PrimaryButton onClick={handleAddDebt}>הוסף לרשימה</PrimaryButton>
          </div>
        </Modal>
      )}

      {/* ══ MODAL: Edit Balance ══ */}
      {editField && (
        <CenterModal
          title={editField === 'bankBalance' ? 'עדכן עובר ושב' : 'עדכן פיקדון לרשיון'}
          onClose={() => setEditField(null)}
        >
          <div className="space-y-4">
            <Input
              label="יתרה חדשה (₪)"
              type="number"
              inputMode="decimal"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              autoFocus
            />
            <PrimaryButton onClick={handleEditBalance}>שמור</PrimaryButton>
          </div>
        </CenterModal>
      )}
    </div>
  )
}
