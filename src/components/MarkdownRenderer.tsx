import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownRendererProps = {
  content: string
  onWikiLinkClick?: (title: string) => void
}

const MarkdownRenderer = ({ content, onWikiLinkClick }: MarkdownRendererProps) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => {
        if (href?.startsWith('wiki://') && onWikiLinkClick) {
          const title = decodeURIComponent(href.replace('wiki://', ''))
          return (
            <button type="button" onClick={() => onWikiLinkClick(title)}>
              {children}
            </button>
          )
        }
        return <a href={href}>{children}</a>
      },
    }}
  >
    {content}
  </ReactMarkdown>
)

export default MarkdownRenderer
