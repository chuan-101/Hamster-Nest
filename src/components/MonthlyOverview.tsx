import { useState } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import type { MonthlyOverviewContent } from '../lib/agentFeed'

type MonthlyOverviewProps = {
  data: MonthlyOverviewContent | null
  loading?: boolean
  monthLabel: string
}

// Feed 页面顶部的「本月概览」板块：展示当月持续进行的事项。
// 内容兼容两种结构：
//   - JSON 主题结构 { themes: [{ theme, items }] } → 按主题分组展示。
//   - markdown / 纯文本 → 直接渲染原文。
// 只有完全查不到 monthly_overview（data 为 null）时才显示空状态。
// 卡片支持收起 / 展开。
const MonthlyOverview = ({ data, loading, monthLabel }: MonthlyOverviewProps) => {
  const [collapsed, setCollapsed] = useState(false)
  const hasThemes = Boolean(data && data.themes.length > 0)
  const rawText = data?.raw?.trim() ?? ''
  const hasRaw = !hasThemes && rawText.length > 0
  const hasContent = hasThemes || hasRaw

  return (
    <section className="feed-overview" aria-label="本月概览">
      <div className="feed-overview__dot" aria-hidden="true" />
      <header className="feed-overview__head">
        <span className="feed-overview__mark" aria-hidden="true">◆</span>
        <h2 className="feed-overview__title">本月概览</h2>
        <span className="feed-overview__month">{monthLabel}</span>
        <button
          type="button"
          className="feed-overview__toggle"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-controls="feed-monthly-overview-body"
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </header>

      {!collapsed ? (
        <div id="feed-monthly-overview-body" className="feed-overview__body">
          {loading && !hasContent ? (
            <p className="feed-overview__empty">正在整理这个月的持续事项…</p>
          ) : null}

          {!loading && !hasContent ? (
            <p className="feed-overview__empty">这个月还没有持续追踪的事项，攒一攒就有了。</p>
          ) : null}

          {hasContent ? (
            hasThemes ? (
              <div className="feed-overview__themes">
                {data!.themes.map((theme, themeIndex) => (
                  <article className="feed-overview__theme" key={`${theme.theme}-${themeIndex}`}>
                    <h3 className="feed-overview__theme-title">{theme.theme}</h3>
                    <ul className="feed-overview__items">
                      {theme.items.map((entry, entryIndex) => (
                        <li className="feed-overview__item" key={entryIndex}>
                          <span className="feed-overview__bullet" aria-hidden="true" />
                          <span className="feed-overview__text">{entry.text}</span>
                          {entry.archive_candidate ? (
                            <span className="feed-overview__flag" title="可沉淀进档案">待沉淀</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <div className="feed-overview__raw">
                {data!.format === 'markdown' ? (
                  <MarkdownRenderer content={rawText} />
                ) : (
                  <p className="feed-overview__plain">{rawText}</p>
                )}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default MonthlyOverview
