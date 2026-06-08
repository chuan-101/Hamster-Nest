import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import type { Database, Json } from '../supabase/types'
import './KnowledgeLibraryPage.css'

type FolderRow = Database['public']['Tables']['knowledge_folders']['Row']
type NodeRow = Database['public']['Tables']['learning_nodes']['Row']
type EdgeRow = Database['public']['Tables']['learning_edges']['Row']
type NodeType = NodeRow['node_type']
type EdgeType = EdgeRow['edge_type']
type Metadata = Record<string, string>
type ViewMode = 'list' | 'graph'

type GraphNode = {
  id: string
  title: string
  nodeType: NodeType
  folderId: string | null
  row: NodeRow
}

type GraphLink = {
  id: string
  source: string
  target: string
  edgeType: EdgeType
  description: string
  strength: number
  isCrossFolder: boolean
}

type NodeEditor = {
  id: string | null
  nodeType: NodeType
  title: string
  content: string
  tags: string
  folderId: string
  metadata: Metadata
}

type EdgeEditor = {
  id: string | null
  targetNodeId: string
  edgeType: EdgeType
  description: string
  strength: number
}

const nodeTypes: NodeType[] = ['concept', 'question', 'insight', 'source', 'quote', 'note', 'application']
const edgeTypes: EdgeType[] = ['association', 'derivation', 'contradiction', 'application', 'reference', 'question']

const nodeTypeMeta: Record<NodeType, { label: string; color: string }> = {
  concept: { label: '概念', color: '#ef7b9e' },
  question: { label: '问题', color: '#a6cf93' },
  insight: { label: '洞见', color: '#fbcfe7' },
  source: { label: '资料', color: '#f2b880' },
  quote: { label: '摘录', color: '#9ca3af' },
  note: { label: '笔记', color: '#6b7280' },
  application: { label: '应用', color: '#89c4c6' },
}

const metadataOptionLabels: Record<string, string> = {
  open: '待探索',
  exploring: '探索中',
  resolved: '已解决',
  idea: '想法',
  in_progress: '进行中',
  done: '已完成',
}

const edgeTypeLabels: Record<EdgeType, string> = {
  association: '关联',
  derivation: '推导',
  contradiction: '矛盾',
  application: '应用',
  reference: '引用',
  question: '提问',
}

const edgeTypeMeta: Record<EdgeType, { color: string; dash: number[] | null }> = {
  association: { color: '#d86f94', dash: null },
  derivation: { color: '#8b5cf6', dash: [8, 5] },
  reference: { color: '#0f9ca3', dash: [2, 5] },
  contradiction: { color: '#ef4444', dash: [10, 4, 2, 4] },
  application: { color: '#2f9fa3', dash: null },
  question: { color: '#74a85f', dash: [4, 4] },
}

const graphDefaultSize = { width: 760, height: 560 }
const graphMinSize = { width: 320, height: 420 }
const graphNodeBoundaryPadding = 76
const graphCenterStrength = 0.42
const graphChargeStrength = -32
const graphAlphaDecay = 0.06
const graphVelocityDecay = 0.55

type TunableForce = {
  strength?: (value: number) => unknown
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const createEmptyEditor = (folderId: string | null): NodeEditor => ({
  id: null,
  nodeType: 'concept',
  title: '',
  content: '',
  tags: '',
  folderId: folderId ?? '',
  metadata: {},
})

const metadataFields: Record<NodeType, Array<{ key: string; label: string; options?: string[] }>> = {
  concept: [{ key: 'source', label: '来源' }],
  question: [
    { key: 'status', label: '状态', options: ['open', 'exploring', 'resolved'] },
    { key: 'answer', label: '答案' },
  ],
  application: [
    { key: 'project', label: '项目名' },
    { key: 'status', label: '状态', options: ['idea', 'in_progress', 'done'] },
  ],
  source: [
    { key: 'url', label: '链接' },
    { key: 'author', label: '作者' },
  ],
  quote: [
    { key: 'origin', label: '出处' },
    { key: 'page', label: '页码' },
  ],
  insight: [],
  note: [],
}

const asMetadata = (value: Json): Metadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item : String(item ?? '')]),
  )
}

const parseTags = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

const formatTime = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

const loadLearningEdges = (client: NonNullable<typeof supabase>) => {
  // learning_edges does not have a user_id column; keep this query unscoped so list and graph views can load edge data.
  return client.from('learning_edges').select('*').order('created_at', { ascending: false })
}

const KnowledgeLibraryPage = () => {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [edges, setEdges] = useState<EdgeRow[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodeTypeFilter, setNodeTypeFilter] = useState<'all' | NodeType>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState({ name: '', icon: '📁', parentId: '' })
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [editor, setEditor] = useState<NodeEditor | null>(null)
  const [edgeEditor, setEdgeEditor] = useState<EdgeEditor | null>(null)
  const [nodeSearch, setNodeSearch] = useState('')
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined)
  const graphWrapRef = useRef<HTMLDivElement | null>(null)
  const [graphSize, setGraphSize] = useState(graphDefaultSize)

  const loadAll = useCallback(async () => {
    if (!supabase) {
      setNotice('Supabase 环境变量未配置，无法读取学习库。')
      return
    }
    setLoading(true)
    const edgeQuery = loadLearningEdges(supabase)
    const [folderResult, nodeResult, edgeResult] = await Promise.all([
      supabase.from('knowledge_folders').select('*').order('created_at', { ascending: true }),
      supabase.from('learning_nodes').select('*').order('created_at', { ascending: false }),
      edgeQuery,
    ])
    setLoading(false)
    const error = folderResult.error ?? nodeResult.error ?? edgeResult.error
    if (error) {
      setNotice(error.message)
      return
    }
    setFolders(folderResult.data ?? [])
    setNodes(nodeResult.data ?? [])
    setEdges(edgeResult.data ?? [])
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => void loadAll(), 0)
    return () => window.clearTimeout(handle)
  }, [loadAll])

  useEffect(() => {
    const element = graphWrapRef.current
    if (!element) return undefined
    const resize = () => {
      const rect = element.getBoundingClientRect()
      setGraphSize({
        width: Math.max(graphMinSize.width, Math.round(rect.width)),
        height: Math.max(graphMinSize.height, Math.round(rect.height)),
      })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'graph') return
    const handle = window.setTimeout(() => graphRef.current?.zoomToFit(500, 48), 120)
    return () => window.clearTimeout(handle)
  }, [viewMode, selectedFolderId, nodeTypeFilter, nodes.length, edges.length])

  const folderOptions = useMemo(() => {
    const byParent = new Map<string | null, FolderRow[]>()
    folders.forEach((folder) => {
      const key = folder.parent_id ?? null
      byParent.set(key, [...(byParent.get(key) ?? []), folder])
    })
    const result: Array<{ folder: FolderRow; depth: number }> = []
    const walk = (parentId: string | null, depth: number) => {
      ;(byParent.get(parentId) ?? []).forEach((folder) => {
        result.push({ folder, depth })
        walk(folder.id, depth + 1)
      })
    }
    walk(null, 0)
    return result
  }, [folders])

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const filteredNodes = useMemo(
    () =>
      nodes.filter((node) => {
        const folderMatches = selectedFolderId ? node.folder_id === selectedFolderId : true
        const typeMatches = nodeTypeFilter === 'all' ? true : node.node_type === nodeTypeFilter
        return folderMatches && typeMatches
      }),
    [nodes, nodeTypeFilter, selectedFolderId],
  )

  const selectedNodeEdges = useMemo(
    () => (selectedNode ? edges.filter((edge) => edge.from_node_id === selectedNode.id || edge.to_node_id === selectedNode.id) : []),
    [edges, selectedNode],
  )

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const graphData = useMemo(() => {
    const visibleIds = new Set(filteredNodes.map((node) => node.id))
    const graphNodes: GraphNode[] = filteredNodes.map((node) => ({
      id: node.id,
      title: node.title,
      nodeType: node.node_type,
      folderId: node.folder_id,
      row: node,
    }))
    const graphLinks: GraphLink[] = edges
      .filter((edge) => visibleIds.has(edge.from_node_id) && visibleIds.has(edge.to_node_id))
      .map((edge) => {
        const source = nodeById.get(edge.from_node_id)
        const target = nodeById.get(edge.to_node_id)
        return {
          id: edge.id,
          source: edge.from_node_id,
          target: edge.to_node_id,
          edgeType: edge.edge_type,
          description: edge.description ?? '无描述',
          strength: edge.strength,
          isCrossFolder: Boolean(source && target && source.folder_id !== target.folder_id),
        }
      })
    return { nodes: graphNodes, links: graphLinks }
  }, [edges, filteredNodes, nodeById])

  useEffect(() => {
    if (viewMode !== 'graph') return
    const graph = graphRef.current
    if (!graph) return
    const centerForce = graph.d3Force('center') as TunableForce | undefined
    const chargeForce = graph.d3Force('charge') as TunableForce | undefined
    centerForce?.strength?.(graphCenterStrength)
    chargeForce?.strength?.(graphChargeStrength)
    graph.d3ReheatSimulation()
  }, [graphData.links.length, graphData.nodes.length, viewMode])

  const childFolderCount = useMemo(() => {
    const count = new Map<string, number>()
    folders.forEach((folder) => {
      if (folder.parent_id) count.set(folder.parent_id, (count.get(folder.parent_id) ?? 0) + 1)
    })
    return count
  }, [folders])
  const folderNodeCount = useMemo(() => {
    const count = new Map<string, number>()
    nodes.forEach((node) => {
      if (node.folder_id) count.set(node.folder_id, (count.get(node.folder_id) ?? 0) + 1)
    })
    return count
  }, [nodes])

  const createFolder = async () => {
    if (!supabase || !folderDraft.name.trim()) return
    const { error } = await supabase.from('knowledge_folders').insert({
      name: folderDraft.name.trim(),
      icon: folderDraft.icon.trim() || '📁',
      parent_id: folderDraft.parentId || null,
    })
    if (error) setNotice(error.message)
    else {
      setFolderDraft({ name: '', icon: '📁', parentId: '' })
      await loadAll()
    }
  }

  const saveFolderName = async (folderId: string) => {
    if (!supabase || !editingFolderName.trim()) return
    const { error } = await supabase.from('knowledge_folders').update({ name: editingFolderName.trim() }).eq('id', folderId)
    if (error) setNotice(error.message)
    else {
      setEditingFolderId(null)
      await loadAll()
    }
  }

  const deleteFolder = async (folderId: string) => {
    if (!supabase) return
    if ((childFolderCount.get(folderId) ?? 0) > 0 || (folderNodeCount.get(folderId) ?? 0) > 0) {
      setNotice('只能删除空文件夹：请先移走子文件夹和节点。')
      return
    }
    const { error } = await supabase.from('knowledge_folders').delete().eq('id', folderId)
    if (error) setNotice(error.message)
    else await loadAll()
  }

  const openCreateNode = () => setEditor(createEmptyEditor(selectedFolderId))
  const openEditNode = (node: NodeRow) =>
    setEditor({
      id: node.id,
      nodeType: node.node_type,
      title: node.title,
      content: node.content ?? '',
      tags: node.tags.join(', '),
      folderId: node.folder_id ?? '',
      metadata: asMetadata(node.metadata),
    })

  const saveNode = async () => {
    if (!supabase || !editor || !editor.title.trim()) return
    const metadata = Object.fromEntries(
      metadataFields[editor.nodeType].map(({ key }) => [key, editor.metadata[key] ?? '']).filter(([, value]) => String(value).trim()),
    )
    const payload = {
      title: editor.title.trim(),
      content: editor.content.trim() || null,
      tags: parseTags(editor.tags),
      folder_id: editor.folderId || null,
      metadata,
    }
    const result = editor.id
      ? await supabase.from('learning_nodes').update(payload).eq('id', editor.id)
      : await supabase.from('learning_nodes').insert({ ...payload, node_type: editor.nodeType })
    if (result.error) setNotice(result.error.message)
    else {
      setEditor(null)
      await loadAll()
    }
  }

  const deleteNode = async (nodeId: string) => {
    if (!supabase) return
    const { error } = await supabase.from('learning_nodes').delete().eq('id', nodeId)
    if (error) setNotice(error.message)
    else {
      setSelectedNodeId(null)
      await loadAll()
    }
  }

  const saveEdge = async () => {
    if (!supabase || !selectedNode || !edgeEditor || !edgeEditor.targetNodeId) return
    if (edgeEditor.targetNodeId === selectedNode.id) {
      setNotice('不允许建立自连边。')
      return
    }
    const edgeDetails = {
      edge_type: edgeEditor.edgeType,
      description: edgeEditor.description.trim() || null,
      strength: edgeEditor.strength,
    }
    const result = edgeEditor.id
      ? await supabase.from('learning_edges').update(edgeDetails).eq('id', edgeEditor.id)
      : await supabase.from('learning_edges').insert({
          ...edgeDetails,
          to_node_id: edgeEditor.targetNodeId,
          from_node_id: selectedNode.id,
        })
    if (result.error) setNotice(result.error.message)
    else {
      setEdgeEditor(null)
      await loadAll()
    }
  }

  const deleteEdge = async (edgeId: string) => {
    if (!supabase) return
    const { error } = await supabase.from('learning_edges').delete().eq('id', edgeId)
    if (error) setNotice(error.message)
    else await loadAll()
  }

  const constrainGraphNode = useCallback((node: NodeObject<GraphNode>) => {
    const xLimit = Math.max(0, graphSize.width / 2 - graphNodeBoundaryPadding)
    const yLimit = Math.max(0, graphSize.height / 2 - graphNodeBoundaryPadding)
    const x = typeof node.x === 'number' ? clamp(node.x, -xLimit, xLimit) : 0
    const y = typeof node.y === 'number' ? clamp(node.y, -yLimit, yLimit) : 0

    if (node.x !== x) {
      node.x = x
      node.vx = 0
    }
    if (node.y !== y) {
      node.y = y
      node.vy = 0
    }
    if (typeof node.fx === 'number') node.fx = clamp(node.fx, -xLimit, xLimit)
    if (typeof node.fy === 'number') node.fy = clamp(node.fy, -yLimit, yLimit)
  }, [graphSize.height, graphSize.width])

  const constrainGraphNodes = useCallback(() => {
    graphData.nodes.forEach(constrainGraphNode)
  }, [constrainGraphNode, graphData.nodes])

  const drawGraphNode = useCallback((node: NodeObject<GraphNode>, context: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.title
    const radius = 7 + Math.min(6, Math.max(0, label.length / 8))
    const x = node.x ?? 0
    const y = node.y ?? 0
    context.beginPath()
    context.arc(x, y, radius, 0, 2 * Math.PI, false)
    context.fillStyle = nodeTypeMeta[node.nodeType].color
    context.fill()
    context.lineWidth = selectedNodeId === node.id ? 3 / globalScale : 1.5 / globalScale
    context.strokeStyle = selectedNodeId === node.id ? '#7c2d52' : 'rgba(255,255,255,0.92)'
    context.stroke()

    const fontSize = Math.max(11 / globalScale, 4)
    context.font = `700 ${fontSize}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'top'
    const textWidth = context.measureText(label).width
    const padding = 3 / globalScale
    context.fillStyle = 'rgba(255, 255, 255, 0.86)'
    context.fillRect(x - textWidth / 2 - padding, y + radius + 2 / globalScale, textWidth + padding * 2, fontSize + padding * 2)
    context.fillStyle = '#4f3f4a'
    context.fillText(label, x, y + radius + 4 / globalScale)
  }, [selectedNodeId])

  const paintGraphNodePointer = useCallback((node: NodeObject<GraphNode>, color: string, context: CanvasRenderingContext2D) => {
    const label = node.title
    const radius = 10 + Math.min(10, Math.max(0, label.length / 7))
    context.fillStyle = color
    context.beginPath()
    context.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false)
    context.fill()
  }, [])

  const searchedTargetNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase()
    return nodes.filter((node) => node.id !== selectedNode?.id && (!query || node.title.toLowerCase().includes(query))).slice(0, 30)
  }, [nodeSearch, nodes, selectedNode])

  return (
    <div className="knowledge-page">
      <header className="knowledge-topbar">
        <button type="button" className="knowledge-ghost" onClick={() => navigate(-1)}>← 返回</button>
        <div className="knowledge-title-wrap">
          <p className="knowledge-kicker">学习知识库</p>
          <h1>仓鼠小窝 · 学习库</h1>
        </div>
        <button type="button" className="knowledge-primary" onClick={openCreateNode}>+ 新建节点</button>
      </header>

      {notice ? <button type="button" className="knowledge-notice" onClick={() => setNotice(null)}>{notice}</button> : null}

      <div className="knowledge-shell">
        <aside className={drawerOpen ? 'knowledge-sidebar' : 'knowledge-sidebar collapsed'}>
          <button type="button" className="drawer-toggle" onClick={() => setDrawerOpen((open) => !open)}>{drawerOpen ? '收起' : '展开'}</button>
          {drawerOpen ? (
            <>
              <button type="button" className={selectedFolderId === null ? 'folder-row active' : 'folder-row'} onClick={() => setSelectedFolderId(null)}>
                <span>🌐 全部</span><em>{nodes.length}</em>
              </button>
              <div className="folder-list">
                {folderOptions.map(({ folder, depth }) => (
                  <div key={folder.id} className="folder-item" style={{ paddingLeft: 10 + depth * 18 }}>
                    {editingFolderId === folder.id ? (
                      <div className="folder-edit-row">
                        <input value={editingFolderName} onChange={(event) => setEditingFolderName(event.target.value)} />
                        <button type="button" onClick={() => void saveFolderName(folder.id)}>保存</button>
                      </div>
                    ) : (
                      <button type="button" className={selectedFolderId === folder.id ? 'folder-row active' : 'folder-row'} onClick={() => setSelectedFolderId(folder.id)}>
                        <span>{folder.icon ?? '📁'} {folder.name}</span><em>{folderNodeCount.get(folder.id) ?? 0}</em>
                      </button>
                    )}
                    <div className="folder-actions">
                      <button type="button" onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name) }}>编辑</button>
                      <button type="button" onClick={() => void deleteFolder(folder.id)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
              <section className="folder-create-card">
                <h2>新建文件夹</h2>
                <input placeholder="图标" value={folderDraft.icon} onChange={(event) => setFolderDraft((draft) => ({ ...draft, icon: event.target.value }))} />
                <input placeholder="文件夹名称" value={folderDraft.name} onChange={(event) => setFolderDraft((draft) => ({ ...draft, name: event.target.value }))} />
                <select value={folderDraft.parentId} onChange={(event) => setFolderDraft((draft) => ({ ...draft, parentId: event.target.value }))}>
                  <option value="">无父级</option>
                  {folderOptions.map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{'—'.repeat(depth)} {folder.name}</option>)}
                </select>
                <button type="button" className="knowledge-primary" onClick={() => void createFolder()}>创建</button>
              </section>
            </>
          ) : null}
        </aside>

        <main className="knowledge-main">
          <div className="knowledge-toolbar">
            <div className="type-tabs">
              <button type="button" className={nodeTypeFilter === 'all' ? 'active' : ''} onClick={() => setNodeTypeFilter('all')}>全部</button>
              {nodeTypes.map((type) => <button key={type} type="button" className={nodeTypeFilter === type ? 'active' : ''} onClick={() => setNodeTypeFilter(type)}>{nodeTypeMeta[type].label}</button>)}
            </div>
            <div className="view-switch" aria-label="学习库视图切换">
              <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>列表</button>
              <button type="button" className={viewMode === 'graph' ? 'active' : ''} onClick={() => setViewMode('graph')}>图谱</button>
            </div>
            <span>{loading ? '加载中…' : `${filteredNodes.length} 个节点 · ${graphData.links.length} 条边`}</span>
          </div>

          {viewMode === 'list' ? (
            <section className="node-grid">
              <div className="node-list">
                {filteredNodes.map((node) => (
                  <article key={node.id} className={selectedNodeId === node.id ? 'node-card active' : 'node-card'} onClick={() => setSelectedNodeId(node.id)}>
                    <span className="type-badge" style={{ background: nodeTypeMeta[node.node_type].color }}>{nodeTypeMeta[node.node_type].label}</span>
                    <h2>{node.title}</h2>
                    <p>{node.content || '暂无正文'}</p>
                    <div className="tag-row">{node.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                    <time>{formatTime(node.created_at)}</time>
                  </article>
                ))}
                {!loading && filteredNodes.length === 0 ? <p className="empty-state">暂无节点，点击右上角新建。</p> : null}
              </div>

              <aside className="node-detail">
                {selectedNode ? (
                  <>
                    <div className="detail-head">
                      <span className="type-badge" style={{ background: nodeTypeMeta[selectedNode.node_type].color }}>{nodeTypeMeta[selectedNode.node_type].label}</span>
                      <h2>{selectedNode.title}</h2>
                      <p>{selectedNode.content}</p>
                      <div className="detail-actions">
                        <button type="button" onClick={() => openEditNode(selectedNode)}>编辑</button>
                        <button type="button" onClick={() => void deleteNode(selectedNode.id)}>删除</button>
                      </div>
                    </div>
                    <section className="edge-panel">
                      <div className="edge-title-row"><h3>联想</h3><button type="button" onClick={() => setEdgeEditor({ id: null, targetNodeId: '', edgeType: 'association', description: '', strength: 3 })}>+ 连边</button></div>
                      {selectedNodeEdges.map((edge) => {
                        const isOutgoing = edge.from_node_id === selectedNode.id
                        const peer = nodeById.get(isOutgoing ? edge.to_node_id : edge.from_node_id)
                        return (
                          <article key={edge.id} className="edge-card">
                            <button type="button" className="edge-peer" onClick={() => peer && setSelectedNodeId(peer.id)}>{isOutgoing ? '→' : '←'} {peer?.title ?? '未知节点'}</button>
                            <span>{edgeTypeLabels[edge.edge_type]} · 强度 {edge.strength}/5</span>
                            <p>{edge.description || '无描述'}</p>
                            <div className="detail-actions">
                              <button type="button" onClick={() => peer && setEdgeEditor({ id: edge.id, targetNodeId: peer.id, edgeType: edge.edge_type, description: edge.description ?? '', strength: edge.strength })}>编辑</button>
                              <button type="button" onClick={() => void deleteEdge(edge.id)}>删除</button>
                            </div>
                          </article>
                        )
                      })}
                    </section>
                  </>
                ) : <p className="empty-state">选择一个节点查看详情和联想。</p>}
              </aside>
            </section>
          ) : (
            <section className="graph-panel">
              <div className="graph-canvas" ref={graphWrapRef}>
                {graphData.nodes.length > 0 ? (
                  <ForceGraph2D
                    ref={graphRef}
                    graphData={graphData}
                    width={graphSize.width}
                    height={graphSize.height}
                    backgroundColor="rgba(255, 250, 253, 0.72)"
                    nodeId="id"
                    nodeLabel={(node) => `${node.title} · ${nodeTypeMeta[node.nodeType].label}`}
                    nodeCanvasObject={drawGraphNode}
                    nodePointerAreaPaint={paintGraphNodePointer}
                    linkLabel={(link) => `${edgeTypeLabels[link.edgeType]}：${link.description || '无描述'}`}
                    linkColor={(link) => link.isCrossFolder ? `${edgeTypeMeta[link.edgeType].color}66` : edgeTypeMeta[link.edgeType].color}
                    linkLineDash={(link) => edgeTypeMeta[link.edgeType].dash}
                    linkWidth={(link) => Math.max(1, link.strength * 0.55)}
                    linkDirectionalArrowLength={4}
                    linkDirectionalArrowRelPos={0.96}
                    linkHoverPrecision={8}
                    d3AlphaDecay={graphAlphaDecay}
                    d3VelocityDecay={graphVelocityDecay}
                    cooldownTime={3600}
                    onEngineTick={constrainGraphNodes}
                    minZoom={0.25}
                    maxZoom={4}
                    enableNodeDrag
                    onNodeDrag={constrainGraphNode}
                    onNodeDragEnd={constrainGraphNode}
                    onNodeClick={(node) => { setSelectedNodeId(node.id); openEditNode(node.row) }}
                  />
                ) : (
                  <p className="empty-state">当前筛选下暂无可展示节点。</p>
                )}
                <div className="graph-legend">
                  {nodeTypes.map((type) => <span key={type}><i style={{ background: nodeTypeMeta[type].color }} />{nodeTypeMeta[type].label}</span>)}
                </div>
              </div>
              <div className="graph-hint">滚轮缩放 · 拖拽画布平移 · 拖拽节点调整布局 · 悬停连边查看描述</div>
            </section>
          )}
        </main>
      </div>

      {editor ? (
        <div className="knowledge-modal-backdrop">
          <section className="knowledge-modal">
            <h2>{editor.id ? '编辑节点' : '新建节点'}</h2>
            <label>类型<select disabled={Boolean(editor.id)} value={editor.nodeType} onChange={(event) => setEditor((current) => current && ({ ...current, nodeType: event.target.value as NodeType, metadata: {} }))}>{nodeTypes.map((type) => <option key={type} value={type}>{nodeTypeMeta[type].label}</option>)}</select></label>
            <label>标题<input value={editor.title} onChange={(event) => setEditor((current) => current && ({ ...current, title: event.target.value }))} /></label>
            <label>正文<textarea value={editor.content} onChange={(event) => setEditor((current) => current && ({ ...current, content: event.target.value }))} /></label>
            <label>标签<input placeholder="逗号分隔" value={editor.tags} onChange={(event) => setEditor((current) => current && ({ ...current, tags: event.target.value }))} /></label>
            <label>文件夹<select value={editor.folderId} onChange={(event) => setEditor((current) => current && ({ ...current, folderId: event.target.value }))}><option value="">不归档</option>{folderOptions.map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{'—'.repeat(depth)} {folder.name}</option>)}</select></label>
            {metadataFields[editor.nodeType].map((field) => (
              <label key={field.key}>{field.label}{field.options ? <select value={editor.metadata[field.key] ?? ''} onChange={(event) => setEditor((current) => current && ({ ...current, metadata: { ...current.metadata, [field.key]: event.target.value } }))}><option value="">未选择</option>{field.options.map((option) => <option key={option} value={option}>{metadataOptionLabels[option] ?? option}</option>)}</select> : <input value={editor.metadata[field.key] ?? ''} onChange={(event) => setEditor((current) => current && ({ ...current, metadata: { ...current.metadata, [field.key]: event.target.value } }))} />}</label>
            ))}
            <div className="modal-actions"><button type="button" className="knowledge-primary" onClick={() => void saveNode()}>保存</button><button type="button" onClick={() => setEditor(null)}>取消</button></div>
          </section>
        </div>
      ) : null}

      {edgeEditor && selectedNode ? (
        <div className="knowledge-modal-backdrop">
          <section className="knowledge-modal">
            <h2>{edgeEditor.id ? '编辑连边' : '新建连边'}</h2>
            <label>搜索节点<input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="输入标题筛选" /></label>
            <label>目标节点<select disabled={Boolean(edgeEditor.id)} value={edgeEditor.targetNodeId} onChange={(event) => setEdgeEditor((current) => current && ({ ...current, targetNodeId: event.target.value }))}><option value="">选择节点</option>{searchedTargetNodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
            <label>类型<select value={edgeEditor.edgeType} onChange={(event) => setEdgeEditor((current) => current && ({ ...current, edgeType: event.target.value as EdgeType }))}>{edgeTypes.map((type) => <option key={type} value={type}>{edgeTypeLabels[type]}</option>)}</select></label>
            <label>描述<textarea value={edgeEditor.description} onChange={(event) => setEdgeEditor((current) => current && ({ ...current, description: event.target.value }))} /></label>
            <label>强度 {edgeEditor.strength}<input type="range" min="1" max="5" value={edgeEditor.strength} onChange={(event) => setEdgeEditor((current) => current && ({ ...current, strength: Number(event.target.value) }))} /></label>
            <div className="modal-actions"><button type="button" className="knowledge-primary" onClick={() => void saveEdge()}>保存</button><button type="button" onClick={() => setEdgeEditor(null)}>取消</button></div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default KnowledgeLibraryPage
