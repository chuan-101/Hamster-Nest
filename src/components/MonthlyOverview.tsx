import type { MonthlyOverviewContent } from '../lib/agentFeed'

type MonthlyOverviewProps = {
  data: MonthlyOverviewContent | null
  loading?: boolean
  monthLabel: string
}

// Feed 页面顶部的「本月概览」板块：按主题分组展示当月持续进行的事项。
// 无数据时显示轻量空状态，不渲染破碎卡片。
const MonthlyOverview = ({ data, loading, monthLabel }: MonthlyOverviewProps) => {
  const hasThemes = Boolean(data && data.themes.length > 0)

  return (
    <section className="feed-overview" aria-label="本月概览">
      <div className="feed-overview__dot" aria-hidden="true" />
      <header className="feed-overview__head">
        <span className="feed-overview__mark" aria-hidden="true">◆</span>
        <h2 className="feed-overview__title">本月概览</h2>
        <span className="feed-overview__month">{monthLabel}</span>
      </header>

      {loading && !hasThemes ? (
        <p className="feed-overview__empty">正在整理这个月的持续事项…</p>
      ) : null}

      {!loading && !hasThemes ? (
        <p className="feed-overview__empty">这个月还没有持续追踪的事项，攒一攒就有了。</p>
      ) : null}

      {hasThemes ? (
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
      ) : null}
    </section>
  )
}

export default MonthlyOverview
