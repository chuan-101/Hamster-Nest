import type { ForumReply } from '../types'

export type ForumReplyTreeNode = {
  reply: ForumReply
  children: ForumReplyTreeNode[]
}

const compareReplies = (a: ForumReply, b: ForumReply) => {
  const createdAtCompare = a.createdAt.localeCompare(b.createdAt)
  if (createdAtCompare !== 0) {
    return createdAtCompare
  }
  return a.id.localeCompare(b.id)
}

const sortTreeNodes = (nodes: ForumReplyTreeNode[]): ForumReplyTreeNode[] => {
  const sorted = [...nodes].sort((left, right) => compareReplies(left.reply, right.reply))
  sorted.forEach((node) => {
    node.children = sortTreeNodes(node.children)
  })
  return sorted
}

export const buildForumReplyTree = (replies: ForumReply[]): ForumReplyTreeNode[] => {
  const nodeMap = new Map<string, ForumReplyTreeNode>()
  replies.forEach((reply) => {
    nodeMap.set(reply.id, { reply, children: [] })
  })

  const roots: ForumReplyTreeNode[] = []

  replies.forEach((reply) => {
    const node = nodeMap.get(reply.id)
    if (!node) {
      return
    }

    if (!reply.parentId) {
      roots.push(node)
      return
    }

    const parentNode = nodeMap.get(reply.parentId)
    if (!parentNode) {
      roots.push(node)
      return
    }

    parentNode.children.push(node)
  })

  return sortTreeNodes(roots)
}
