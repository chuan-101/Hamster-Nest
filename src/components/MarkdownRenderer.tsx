import { Fragment, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownRendererProps = {
  content: string
  onWikiLinkClick?: (title: string) => void
}

const WIKI_LINK_HREF = '#__wikilink__'
const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g

const extractText = (node: ReactNode): string => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

const MarkdownRenderer = ({ content, onWikiLinkClick }: MarkdownRendererProps) => {
  const processed = content.replace(WIKI_LINK_PATTERN, (_match, title: string) => {
    return `[${title.trim()}](${WIKI_LINK_HREF})`
  })

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href === WIKI_LINK_HREF) {
            const title = extractText(children).trim()
            if (!onWikiLinkClick) {
              return <Fragment>{children}</Fragment>
            }
            return (
              <button type="button" className="wiki-link" onClick={() => onWikiLinkClick(title)}>
                {children}
              </button>
            )
          }
          return <a href={href}>{children}</a>
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  )
}

export default MarkdownRenderer
