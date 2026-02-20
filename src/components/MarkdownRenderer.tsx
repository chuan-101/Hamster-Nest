import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownRendererProps = {
  content: string
}

const MarkdownRenderer = ({ content }: MarkdownRendererProps) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
)

export default MarkdownRenderer
