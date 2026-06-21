import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TodoCategory, TodoCreatedBy, TodoItem, TodoStatus, TodoType } from '../types'
import {
  createTodoCategory,
  createTodoItem,
  deleteTodoCategory,
  deleteTodoItem,
  listTodoCategoriesByDate,
  listTodoDashboard,
  listTodosByDate,
  listTodosByMonth,
  updateTodoItem,
  updateTodoItemStatus,
  type TodoDashboardData,
} from '../storage/supabaseSync'
import './TimelinePage.css'
import './TodoPage.css'

type TodoView = 'calendar' | 'dashboard'

type TodoEditorState = {
  mode: 'create' | 'edit'
  categoryId: string
  todoId?: string
  title: string
  notes: string
  createdBy: TodoCreatedBy
  todoType: TodoType
  eventDate: string
}

type CalendarTodoMeta = {
  total: number
  pending: number
  completed: number
}

const CREATED_BY_META: Record<TodoCreatedBy, { emoji: string; label: string }> = {
  串串: { emoji: '🐹', label: '串串' },
  syzygy: { emoji: '💙', label: 'syzygy' },
}

// 点击状态按钮时的循环顺序：未完成 → 进行中 → 已完成 → 未完成。
const STATUS_CYCLE: Record<TodoStatus, TodoStatus> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
}

const STATUS_GLYPH: Record<TodoStatus, string> = {
  pending: '',
  in_progress: '◐',
  completed: '✓',
}

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '未完成',
  in_progress: '进行中',
  completed: '已完成',
}

const STATUS_NOTICE: Record<TodoStatus, string> = {
  pending: '已恢复为未完成',
  in_progress: '已标记进行中',
  completed: '已完成待办',
}

const toLocalDateKey = (value: Date) => {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getTodayDate = () => toLocalDateKey(new Date())

const getMonthRange = (anchorDate: Date) => {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  return {
    monthLabel: `${year}年${month + 1}月`,
    start: toLocalDateKey(new Date(year, month, 1)),
    end: toLocalDateKey(new Date(year, month + 1, 0)),
  }
}

const TodoPage = () => {
  const navigate = useNavigate()
  const today = useMemo(() => getTodayDate(), [])
  const [view, setView] = useState<TodoView>('calendar')
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState(today)
  const [monthTodos, setMonthTodos] = useState<TodoItem[]>([])
  const [categories, setCategories] = useState<TodoCategory[]>([])
  const [dayTodos, setDayTodos] = useState<TodoItem[]>([])
  const [dashboard, setDashboard] = useState<TodoDashboardData>({ nearTermOpen: [], longTerm: [] })
  const [monthLoading, setMonthLoading] = useState(true)
  const [dayLoading, setDayLoading] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [editor, setEditor] = useState<TodoEditorState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const monthRange = useMemo(() => getMonthRange(monthCursor), [monthCursor])

  const refreshMonth = useCallback(async () => {
    setMonthLoading(true)
    try {
      const data = await listTodosByMonth(monthRange.start, monthRange.end)
      setMonthTodos(data)
      setError(null)
    } catch (loadError) {
      console.warn('加载待办月份失败', loadError)
      setError('加载月份待办失败，请稍后重试')
    } finally {
      setMonthLoading(false)
    }
  }, [monthRange.end, monthRange.start])

  const refreshSelectedDate = useCallback(async () => {
    setDayLoading(true)
    try {
      const [categoryData, todoData] = await Promise.all([
        listTodoCategoriesByDate(selectedDate),
        listTodosByDate(selectedDate),
      ])
      setCategories(categoryData)
      setDayTodos(todoData)
      setError(null)
    } catch (loadError) {
      console.warn('加载当天待办失败', loadError)
      setError('加载当天待办失败，请稍后重试')
    } finally {
      setDayLoading(false)
    }
  }, [selectedDate])

  const refreshDashboard = useCallback(async () => {
    setDashboardLoading(true)
    try {
      const data = await listTodoDashboard()
      setDashboard(data)
      setError(null)
    } catch (loadError) {
      console.warn('加载待办仪表盘失败', loadError)
      setError('加载待办仪表盘失败，请稍后重试')
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshMonth(), refreshSelectedDate(), refreshDashboard()])
  }, [refreshMonth, refreshSelectedDate, refreshDashboard])

  useEffect(() => {
    void refreshMonth()
  }, [refreshMonth])

  useEffect(() => {
    void refreshSelectedDate()
  }, [refreshSelectedDate])

  useEffect(() => {
    void refreshDashboard()
  }, [refreshDashboard])

  const dashboardPending = useMemo(
    () => dashboard.nearTermOpen.filter((todo) => todo.status === 'pending'),
    [dashboard],
  )
  const dashboardInProgress = useMemo(
    () => dashboard.nearTermOpen.filter((todo) => todo.status === 'in_progress'),
    [dashboard],
  )

  const todosByDate = useMemo(() => {
    const groups = new Map<string, CalendarTodoMeta>()
    monthTodos.forEach((todo) => {
      const current = groups.get(todo.date) ?? { total: 0, pending: 0, completed: 0 }
      current.total += 1
      if (todo.status === 'completed') {
        current.completed += 1
      } else {
        current.pending += 1
      }
      groups.set(todo.date, current)
    })
    return groups
  }, [monthTodos])

  const todosByCategory = useMemo(() => {
    const groups = new Map<string, TodoItem[]>()
    dayTodos.forEach((todo) => {
      const current = groups.get(todo.categoryId) ?? []
      current.push(todo)
      groups.set(todo.categoryId, current)
    })
    return groups
  }, [dayTodos])

  const calendarCells = useMemo(() => {
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    const firstWeekday = first.getDay()
    const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
    const cells: Array<{ dateKey: string; day: number; meta?: CalendarTodoMeta } | null> = []

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null)
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = toLocalDateKey(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day))
      cells.push({ dateKey, day, meta: todosByDate.get(dateKey) })
    }
    while (cells.length % 7 !== 0) {
      cells.push(null)
    }
    return cells
  }, [monthCursor, todosByDate])

  const shiftMonth = (delta: number) => {
    setMonthCursor((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + delta, 1)
      const todayDate = new Date()
      const nextSelected =
        next.getFullYear() === todayDate.getFullYear() && next.getMonth() === todayDate.getMonth()
          ? today
          : toLocalDateKey(next)
      setSelectedDate(nextSelected)
      return next
    })
  }

  const handleCreateCategory = async (event: FormEvent) => {
    event.preventDefault()
    const name = categoryName.trim()
    if (!name) {
      setError('类目名称不能为空')
      return
    }
    setSaving(true)
    try {
      await createTodoCategory({ date: selectedDate, name, sortOrder: categories.length })
      setCategoryName('')
      setShowCategoryForm(false)
      setNotice('类目已创建')
      setError(null)
      await refreshSelectedDate()
    } catch (saveError) {
      console.warn('创建类目失败', saveError)
      setError('创建类目失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const openCreateTodo = (categoryId: string) => {
    setEditor({
      mode: 'create',
      categoryId,
      title: '',
      notes: '',
      createdBy: '串串',
      todoType: 'short_term',
      eventDate: '',
    })
  }

  const openEditTodo = (todo: TodoItem) => {
    setEditor({
      mode: 'edit',
      categoryId: todo.categoryId,
      todoId: todo.id,
      title: todo.title,
      notes: todo.notes ?? '',
      createdBy: todo.createdBy,
      todoType: todo.todoType,
      eventDate: todo.eventDate ?? '',
    })
  }

  const handleSaveTodo = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor) {
      return
    }
    const title = editor.title.trim()
    const notes = editor.notes.trim()
    if (!title) {
      setError('待办标题不能为空')
      return
    }
    const eventDate = editor.todoType === 'long_term' ? editor.eventDate || null : null
    setSaving(true)
    try {
      if (editor.mode === 'create') {
        const categoryTodos = todosByCategory.get(editor.categoryId) ?? []
        await createTodoItem({
          categoryId: editor.categoryId,
          date: selectedDate,
          title,
          notes: notes || null,
          createdBy: editor.createdBy,
          sortOrder: categoryTodos.length,
          todoType: editor.todoType,
          eventDate,
        })
        setNotice('待办已创建')
      } else if (editor.todoId) {
        await updateTodoItem(editor.todoId, {
          title,
          notes: notes || null,
          createdBy: editor.createdBy,
          todoType: editor.todoType,
          eventDate,
        })
        setNotice('待办已更新')
      }
      setEditor(null)
      setError(null)
      await refreshAll()
    } catch (saveError) {
      console.warn('保存待办失败', saveError)
      setError('保存待办失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTodo = async (todo: TodoItem) => {
    const confirmed = window.confirm(`确认删除待办「${todo.title}」吗？此操作不可撤销。`)
    if (!confirmed) {
      return
    }
    setSaving(true)
    try {
      await deleteTodoItem(todo.id)
      setNotice('待办已删除')
      setError(null)
      await refreshAll()
    } catch (deleteError) {
      console.warn('删除待办失败', deleteError)
      setError('删除待办失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCategory = async (category: TodoCategory) => {
    const categoryTodos = todosByCategory.get(category.id) ?? []
    const confirmed = window.confirm(
      categoryTodos.length > 0
        ? `确认删除类目「${category.name}」吗？该类目下的 ${categoryTodos.length} 条待办也会一起删除，此操作不可撤销。`
        : `确认删除类目「${category.name}」吗？此操作不可撤销。`,
    )
    if (!confirmed) {
      return
    }
    setSaving(true)
    try {
      await deleteTodoCategory(category.id)
      setNotice('类目已删除')
      setError(null)
      await refreshAll()
    } catch (deleteError) {
      console.warn('删除类目失败', deleteError)
      setError('删除类目失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleAdvanceStatus = async (todo: TodoItem) => {
    const nextStatus = STATUS_CYCLE[todo.status]
    setSaving(true)
    try {
      await updateTodoItemStatus(todo.id, nextStatus)
      setNotice(STATUS_NOTICE[nextStatus])
      setError(null)
      await refreshAll()
    } catch (saveError) {
      console.warn('更新待办状态失败', saveError)
      setError('更新状态失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const renderDashboardTodo = (todo: TodoItem) => {
    const creator = CREATED_BY_META[todo.createdBy] ?? CREATED_BY_META.串串
    const completed = todo.status === 'completed'
    const inProgress = todo.status === 'in_progress'
    const meta =
      todo.todoType === 'long_term'
        ? `🎯 ${todo.eventDate ?? '未定目标日期'}`
        : `📅 ${todo.date}`
    return (
      <article
        className={['todo-item', completed && 'todo-item--completed', inProgress && 'todo-item--in-progress'].filter(Boolean).join(' ')}
        key={todo.id}
      >
        <button
          type="button"
          className={`todo-item__status todo-item__status--${todo.status}`}
          onClick={() => handleAdvanceStatus(todo)}
          aria-label={`当前${STATUS_LABEL[todo.status]}，点击切换为${STATUS_LABEL[STATUS_CYCLE[todo.status]]}`}
          title={STATUS_LABEL[todo.status]}
          disabled={saving}
        >
          {STATUS_GLYPH[todo.status]}
        </button>
        <button type="button" className="todo-item__content" onClick={() => openEditTodo(todo)}>
          <span className="todo-item__title">{todo.title}</span>
          <span className="todo-item__meta">{meta}</span>
        </button>
        <span className="todo-item__creator" title={creator.label}>{creator.emoji}</span>
      </article>
    )
  }

  return (
    <div className="timeline-page todo-page">
      <header className="timeline-header">
        <button type="button" className="ghost timeline-back-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <div className="timeline-title-wrap">
          <p className="timeline-kicker">To do</p>
          <h1 className="ui-title">待办小窝</h1>
        </div>
        {view === 'calendar' ? (
          <button type="button" className="timeline-create-btn" onClick={() => setShowCategoryForm(true)}>
            + 类目
          </button>
        ) : null}
      </header>

      <div className="todo-view-switch" role="tablist" aria-label="待办视图切换">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'calendar'}
          className={['todo-view-switch__btn', view === 'calendar' && 'is-active'].filter(Boolean).join(' ')}
          onClick={() => setView('calendar')}
        >
          📅 日历
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'dashboard'}
          className={['todo-view-switch__btn', view === 'dashboard' && 'is-active'].filter(Boolean).join(' ')}
          onClick={() => setView('dashboard')}
        >
          📊 仪表盘
        </button>
      </div>

      {view === 'calendar' ? (
      <section className="timeline-calendar" aria-label="待办月份日历">
        <div className="timeline-calendar__dot" aria-hidden="true" />
        <div className="timeline-calendar__top">
          <button type="button" className="ghost" onClick={() => shiftMonth(-1)}>
            ← 上月
          </button>
          <strong>{monthRange.monthLabel}</strong>
          <button type="button" className="ghost" onClick={() => shiftMonth(1)}>
            下月 →
          </button>
        </div>
        <div className="timeline-calendar__weekdays">
          {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="timeline-calendar__grid">
          {calendarCells.map((cell, index) =>
            cell ? (
              <button
                key={cell.dateKey}
                type="button"
                className={[
                  'timeline-calendar__cell',
                  cell.meta && 'has-entry',
                  cell.meta?.pending ? 'todo-calendar__cell--pending' : null,
                  cell.meta && cell.meta.pending === 0 ? 'todo-calendar__cell--done' : null,
                  cell.dateKey === today && 'today',
                  cell.dateKey === selectedDate && 'selected',
                ].filter(Boolean).join(' ')}
                title={cell.meta ? `${cell.dateKey} 有 ${cell.meta.total} 条待办` : cell.dateKey}
                onClick={() => setSelectedDate(cell.dateKey)}
                aria-pressed={cell.dateKey === selectedDate}
              >
                <span>{cell.day}</span>
                {cell.meta?.pending ? <i aria-label={`${cell.meta.pending} 条待完成`} /> : null}
                {cell.meta && cell.meta.pending === 0 ? <em>✓</em> : null}
              </button>
            ) : (
              <div key={`blank-${index}`} className="timeline-calendar__cell timeline-calendar__cell--blank" />
            ),
          )}
        </div>
        {monthLoading ? <p className="todo-calendar-loading">月历提示加载中…</p> : null}
      </section>
      ) : null}

      {notice ? <p className="timeline-notice">{notice}</p> : null}
      {error ? <p className="timeline-error">{error}</p> : null}

      {view === 'calendar' ? (
      <section className="timeline-list todo-detail" aria-label="当天待办">
        <div className="todo-detail__top">
          <div>
            <p className="timeline-kicker">Selected day</p>
            <h2>{selectedDate}</h2>
          </div>
          <button type="button" className="todo-soft-btn" onClick={() => setShowCategoryForm((value) => !value)}>
            {showCategoryForm ? '收起' : '+ 新增类目'}
          </button>
        </div>

        {showCategoryForm ? (
          <form className="todo-inline-form" onSubmit={handleCreateCategory}>
            <input
              type="text"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="例如：今天的小事、工作、窝里清单"
              disabled={saving}
            />
            <button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </form>
        ) : null}

        {dayLoading ? <p className="tips">加载中…</p> : null}
        {!dayLoading && categories.length === 0 ? (
          <div className="timeline-empty todo-empty">
            <strong>今天还没有类目</strong>
            <span>先搭一个软乎乎的小分区，再把待办放进去吧。</span>
            <button type="button" className="todo-soft-btn" onClick={() => setShowCategoryForm(true)}>
              创建第一个类目
            </button>
          </div>
        ) : null}

        {!dayLoading && categories.length > 0 ? (
          <div className="todo-category-list">
            {categories.map((category) => {
              const categoryTodos = todosByCategory.get(category.id) ?? []
              return (
                <article className="todo-category-card" key={category.id}>
                  <div className="todo-category-card__head">
                    <h3>{category.name}</h3>
                    <div className="todo-category-card__actions">
                      <button type="button" className="todo-soft-btn" onClick={() => openCreateTodo(category.id)}>
                        + 待办
                      </button>
                      <button
                        type="button"
                        className="todo-danger-btn"
                        onClick={() => handleDeleteCategory(category)}
                        disabled={saving}
                      >
                        删除类目
                      </button>
                    </div>
                  </div>
                  {categoryTodos.length === 0 ? (
                    <p className="todo-category-empty">这个类目下还没有待办。</p>
                  ) : (
                    <div className="todo-items">
                      {categoryTodos.map((todo) => {
                        const creator = CREATED_BY_META[todo.createdBy] ?? CREATED_BY_META.串串
                        const completed = todo.status === 'completed'
                        const inProgress = todo.status === 'in_progress'
                        return (
                          <article
                            className={['todo-item', completed && 'todo-item--completed', inProgress && 'todo-item--in-progress'].filter(Boolean).join(' ')}
                            key={todo.id}
                          >
                            <button
                              type="button"
                              className={`todo-item__status todo-item__status--${todo.status}`}
                              onClick={() => handleAdvanceStatus(todo)}
                              aria-label={`当前${STATUS_LABEL[todo.status]}，点击切换为${STATUS_LABEL[STATUS_CYCLE[todo.status]]}`}
                              title={STATUS_LABEL[todo.status]}
                              disabled={saving}
                            >
                              {STATUS_GLYPH[todo.status]}
                            </button>
                            <button type="button" className="todo-item__content" onClick={() => openEditTodo(todo)}>
                              <span className="todo-item__title">{todo.title}</span>
                              {todo.todoType === 'long_term' ? (
                                <span className="todo-item__badge">长期{todo.eventDate ? ` · ${todo.eventDate}` : ''}</span>
                              ) : null}
                              {todo.notes ? <span className="todo-item__notes">{todo.notes}</span> : null}
                            </button>
                            <div className="todo-item__actions">
                              <span className="todo-item__creator" title={creator.label}>{creator.emoji}</span>
                              <button
                                type="button"
                                className="todo-item__delete"
                                onClick={() => handleDeleteTodo(todo)}
                                disabled={saving}
                                aria-label={`删除待办：${todo.title}`}
                                title="删除"
                              >
                                <span aria-hidden="true">×</span>
                              </button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ) : null}
      </section>
      ) : null}

      {view === 'dashboard' ? (
        <section className="todo-dashboard" aria-label="待办仪表盘">
          {dashboardLoading ? <p className="tips">加载中…</p> : null}
          <div className="todo-dashboard__columns">
            <article className="todo-dashboard__col">
              <header className="todo-dashboard__col-head">
                <h3>未完成</h3>
                <span className="todo-dashboard__count">{dashboardPending.length}</span>
              </header>
              {dashboardPending.length === 0 ? (
                <p className="todo-dashboard__empty">没有未完成的近期待办</p>
              ) : (
                <div className="todo-dashboard__list">{dashboardPending.map(renderDashboardTodo)}</div>
              )}
            </article>

            <article className="todo-dashboard__col">
              <header className="todo-dashboard__col-head">
                <h3>进行中</h3>
                <span className="todo-dashboard__count">{dashboardInProgress.length}</span>
              </header>
              {dashboardInProgress.length === 0 ? (
                <p className="todo-dashboard__empty">还没有进行中的待办</p>
              ) : (
                <div className="todo-dashboard__list">{dashboardInProgress.map(renderDashboardTodo)}</div>
              )}
            </article>

            <article className="todo-dashboard__col">
              <header className="todo-dashboard__col-head">
                <h3>长期待办</h3>
                <span className="todo-dashboard__count">{dashboard.longTerm.length}</span>
              </header>
              {dashboard.longTerm.length === 0 ? (
                <p className="todo-dashboard__empty">还没有长期待办</p>
              ) : (
                <div className="todo-dashboard__list">{dashboard.longTerm.map(renderDashboardTodo)}</div>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {editor ? (
        <div className="timeline-editor-backdrop" role="dialog" aria-modal="true">
          <form className="timeline-editor todo-editor" onSubmit={handleSaveTodo}>
            <h2>{editor.mode === 'create' ? '新建待办' : '编辑待办'}</h2>
            <label>
              标题
              <input
                type="text"
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                required
              />
            </label>
            <label>
              备注
              <textarea
                value={editor.notes}
                onChange={(event) => setEditor({ ...editor, notes: event.target.value })}
                rows={4}
                placeholder="可选：写一点细节"
              />
            </label>
            <label>
              创建者
              <select
                value={editor.createdBy}
                onChange={(event) => setEditor({ ...editor, createdBy: event.target.value as TodoCreatedBy })}
              >
                <option value="串串">🐹 串串</option>
                <option value="syzygy">💙 syzygy</option>
              </select>
            </label>
            <label>
              待办类型
              <select
                value={editor.todoType}
                onChange={(event) => setEditor({ ...editor, todoType: event.target.value as TodoType })}
              >
                <option value="short_term">近期待办</option>
                <option value="long_term">长期待办</option>
              </select>
            </label>
            {editor.todoType === 'long_term' ? (
              <label>
                目标日期
                <input
                  type="date"
                  value={editor.eventDate}
                  onChange={(event) => setEditor({ ...editor, eventDate: event.target.value })}
                />
              </label>
            ) : null}
            <div className="timeline-editor__actions">
              <button type="button" className="secondary" onClick={() => setEditor(null)} disabled={saving}>
                取消
              </button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default TodoPage
