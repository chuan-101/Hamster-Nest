import type { StashFolder, StashItem } from '../types'
import { getRecordSourceLabel } from '../constants/recordSources'

// 囤粮处共用：标签、树工具、链接展示。链接归一化规则在 stash_contract.ts（与 MCP 共用）。

export const STASH_STATUS_LABELS: Record<string, string> = {
  stashed: '囤着',
  eaten: '吃掉了',
}

export const getStashStatusLabel = (status: string) => STASH_STATUS_LABELS[status] ?? status

// 谁囤的 / 谁留言：串串是 🐹，各端口是 🩵 + 端口名。
export const getStashAuthorLabel = (author: string) =>
  author === 'chuanchuan' ? '🐹 串串' : `🩵 ${getRecordSourceLabel(author)}`

export const DEFAULT_STASH_FOLDER_ICON = '📁'

export const getFolderIcon = (folder: StashFolder | null | undefined) => folder?.icon || DEFAULT_STASH_FOLDER_ICON

// 从某个格子一路向上到根，返回 [根 … 当前]；断链（父格子不存在）就停在能找到的地方。
export const buildStashBreadcrumb = (folders: Map<string, StashFolder>, folderId: string | null): StashFolder[] => {
  const trail: StashFolder[] = []
  let cursor = folderId
  let guard = 0
  while (cursor && guard < 64) {
    const folder = folders.get(cursor)
    if (!folder) break
    trail.unshift(folder)
    cursor = folder.parentId
    guard += 1
  }
  return trail
}

// 某个格子的全部子孙 id（用来禁止把格子挪进自己的子树）。
export const collectStashDescendantIds = (folders: StashFolder[], rootId: string): Set<string> => {
  const childrenByParent = new Map<string | null, StashFolder[]>()
  folders.forEach((folder) => {
    const list = childrenByParent.get(folder.parentId) ?? []
    list.push(folder)
    childrenByParent.set(folder.parentId, list)
  })
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const child of childrenByParent.get(current) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id)
        queue.push(child.id)
      }
    }
  }
  return result
}

// 「移动到」菜单要一份带缩进的扁平列表：按树的先序排，depth 用来缩进。
export const flattenStashFolderTree = (folders: StashFolder[]): Array<{ folder: StashFolder; depth: number }> => {
  const childrenByParent = new Map<string | null, StashFolder[]>()
  folders.forEach((folder) => {
    const list = childrenByParent.get(folder.parentId) ?? []
    list.push(folder)
    childrenByParent.set(folder.parentId, list)
  })
  const result: Array<{ folder: StashFolder; depth: number }> = []
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      if (depth > 64) return
      result.push({ folder, depth })
      visit(folder.id, depth + 1)
    }
  }
  visit(null, 0)
  return result
}

// 链接卡片上只显示域名（去 www.），点开才是全链接。
export const getStashItemHost = (item: StashItem) => {
  if (!item.url) return null
  try {
    return new URL(item.url).hostname.replace(/^www\./u, '')
  } catch {
    return item.url
  }
}

export const matchesStashKeyword = (item: StashItem, keyword: string) => {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return true
  return (
    item.title.toLowerCase().includes(needle) ||
    (item.content ?? '').toLowerCase().includes(needle) ||
    (item.url ?? '').toLowerCase().includes(needle) ||
    item.tags.some((tag) => tag.toLowerCase().includes(needle))
  )
}

export const parseStashTagsInput = (value: string) =>
  value
    .split(/[,，\n]/u)
    .map((tag) => tag.trim())
    .filter((tag, index, list) => tag && list.indexOf(tag) === index)
