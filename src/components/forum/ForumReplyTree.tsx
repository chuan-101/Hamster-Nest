import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import MarkdownRenderer from '../MarkdownRenderer'
import type { ForumReply } from '../../types'
import type { ForumReplyTreeNode } from '../../utils/forumReplyTree'

type ForumReplyTreeProps = {
  nodes: ForumReplyTreeNode[]
  activeInlineReplyId: string | null
  deletingReplyId: string | null
  getAuthorLabel: (reply: ForumReply) => string
  getReplyTargetLabel: (reply: ForumReply) => string
  formatTime: (value: string) => string
  onToggleInlineReply: (replyId: string) => void
  onDeleteReply: (replyId: string) => void
  renderInlineEditor: (reply: ForumReply) => ReactNode
}

const ForumReplyTree = ({
  nodes,
  activeInlineReplyId,
  deletingReplyId,
  getAuthorLabel,
  getReplyTargetLabel,
  formatTime,
  onToggleInlineReply,
  onDeleteReply,
  renderInlineEditor,
}: ForumReplyTreeProps) => {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set())

  const toggleNode = useCallback((replyId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current)
      if (next.has(replyId)) {
        next.delete(replyId)
      } else {
        next.add(replyId)
      }
      return next
    })
  }, [])

  const renderNode = (node: ForumReplyTreeNode, depth: number): ReactNode => {
    const { reply, children } = node
    const hasChildren = children.length > 0
    const collapsed = hasChildren ? collapsedNodeIds.has(reply.id) : false
    const style = { '--forum-reply-depth': depth } as CSSProperties

    return (
      <div className="forum-reply-node" key={reply.id} style={style}>
        <article className="forum-reply-item">
          <header className="forum-bbs-card__author forum-bbs-card__author--reply">
            <strong>{getAuthorLabel(reply)}</strong>
            <small>{formatTime(reply.createdAt)}</small>
          </header>
          <div className="forum-bbs-card__content forum-bbs-card__content--reply">
            <div className="assistant-markdown">
              <MarkdownRenderer content={reply.content} />
            </div>
          </div>
          <footer className="forum-reply-item__footer">
            <span>回复给：{getReplyTargetLabel(reply)}</span>
            {hasChildren ? (
              <button type="button" className="btn-secondary" onClick={() => toggleNode(reply.id)}>
                {collapsed ? `展开 ${children.length} 条子回复` : `收起 ${children.length} 条子回复`}
              </button>
            ) : null}
            <button type="button" className="btn-secondary" onClick={() => onToggleInlineReply(reply.id)}>
              {activeInlineReplyId === reply.id ? '收起回复' : '回复'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onDeleteReply(reply.id)}
              disabled={deletingReplyId === reply.id}
            >
              {deletingReplyId === reply.id ? '删除中…' : '删除'}
            </button>
          </footer>
          {activeInlineReplyId === reply.id ? renderInlineEditor(reply) : null}
        </article>
        {hasChildren && !collapsed ? (
          <div className="forum-reply-node__children">{children.map((child) => renderNode(child, depth + 1))}</div>
        ) : null}
      </div>
    )
  }

  return <div className="forum-reply-tree">{nodes.map((node) => renderNode(node, 0))}</div>
}

export default ForumReplyTree
