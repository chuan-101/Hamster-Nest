import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  addSessionToGroup,
  createStoryGroup,
  deleteStoryGroup,
  fetchRpSessions,
  fetchSessionGroups,
  fetchStoryGroups,
  removeSessionFromGroup,
  renameStoryGroup,
} from '../storage/supabaseSync'
import type { RpSession, RpSessionGroup, RpStoryGroup } from '../types'
import './StoryGroupPage.css'

type StoryGroupPageProps = {
  user: User | null
}

const formatTime = (timestamp: string) =>
  new Date(timestamp).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const StoryGroupPage = ({ user }: StoryGroupPageProps) => {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<RpStoryGroup[]>([])
  const [sessions, setSessions] = useState<RpSession[]>([])
  const [sessionGroupLinks, setSessionGroupLinks] = useState<RpSessionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Create group
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  // Rename group
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [savingRename, setSavingRename] = useState(false)

  // Delete group
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<RpStoryGroup | null>(null)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)

  // Assign session
  const [assigningSessionId, setAssigningSessionId] = useState<string | null>(null)

  // Expanded groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const sessionToGroupMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const link of sessionGroupLinks) {
      map.set(link.sessionId, link.storyGroupId)
    }
    return map
  }, [sessionGroupLinks])

  const groupedSessions = useMemo(() => {
    const map = new Map<string, RpSession[]>()
    for (const group of groups) {
      map.set(group.id, [])
    }
    for (const session of sessions) {
      const groupId = sessionToGroupMap.get(session.id)
      if (groupId && map.has(groupId)) {
        map.get(groupId)!.push(session)
      }
    }
    return map
  }, [groups, sessions, sessionToGroupMap])

  const ungroupedSessions = useMemo(
    () => sessions.filter((s) => !sessionToGroupMap.has(s.id)),
    [sessions, sessionToGroupMap],
  )

  const loadAll = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [fetchedGroups, fetchedSessions, fetchedLinks] = await Promise.all([
        fetchStoryGroups(user.id),
        fetchRpSessions(user.id, false),
        fetchSessionGroups(user.id),
      ])
      setGroups(fetchedGroups)
      setSessions(fetchedSessions)
      setSessionGroupLinks(fetchedLinks)
    } catch {
      setError('加载数据失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleCreate = async () => {
    if (!user || creating) return
    const name = newGroupName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const group = await createStoryGroup(user.id, name)
      setGroups((prev) => [...prev, group])
      setNewGroupName('')
      setNotice('故事组创建成功')
      setExpandedGroups((prev) => new Set(prev).add(group.id))
    } catch {
      setError('创建故事组失败。')
    } finally {
      setCreating(false)
    }
  }

  const startRename = (group: RpStoryGroup) => {
    setRenamingGroupId(group.id)
    setRenameInput(group.name)
  }

  const handleRename = async () => {
    if (!renamingGroupId || savingRename) return
    const name = renameInput.trim()
    if (!name) return
    setSavingRename(true)
    setError(null)
    setNotice(null)
    try {
      await renameStoryGroup(renamingGroupId, name)
      setGroups((prev) =>
        prev.map((g) => (g.id === renamingGroupId ? { ...g, name } : g)),
      )
      setRenamingGroupId(null)
      setRenameInput('')
      setNotice('已重命名')
    } catch {
      setError('重命名失败。')
    } finally {
      setSavingRename(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!pendingDeleteGroup) return
    setDeletingGroupId(pendingDeleteGroup.id)
    setError(null)
    setNotice(null)
    try {
      await deleteStoryGroup(pendingDeleteGroup.id)
      setGroups((prev) => prev.filter((g) => g.id !== pendingDeleteGroup.id))
      setSessionGroupLinks((prev) =>
        prev.filter((link) => link.storyGroupId !== pendingDeleteGroup.id),
      )
      setPendingDeleteGroup(null)
      setNotice('故事组已删除（session 未受影响）')
    } catch {
      setError('删除故事组失败。')
    } finally {
      setDeletingGroupId(null)
    }
  }

  const handleAssignSession = async (sessionId: string, groupId: string) => {
    setError(null)
    setNotice(null)
    try {
      const link = await addSessionToGroup(sessionId, groupId)
      setSessionGroupLinks((prev) => [
        ...prev.filter((l) => l.sessionId !== sessionId),
        link,
      ])
      setAssigningSessionId(null)
      setNotice('已归入故事组')
    } catch {
      setError('归入故事组失败。')
    }
  }

  const handleRemoveSession = async (sessionId: string) => {
    setError(null)
    setNotice(null)
    try {
      await removeSessionFromGroup(sessionId)
      setSessionGroupLinks((prev) => prev.filter((l) => l.sessionId !== sessionId))
      setNotice('已从故事组移出')
    } catch {
      setError('移出故事组失败。')
    }
  }

  return (
    <div className="story-group-page app-shell">
      <header className="story-group-header">
        <button type="button" className="ghost" onClick={() => navigate('/rp')}>
          返回
        </button>
        <h1 className="ui-title">故事组管理</h1>
        <span style={{ width: 40 }} />
      </header>

      <div className="story-group-content">
        {loading ? (
          <p className="story-group-loading">加载中…</p>
        ) : (
          <>
            {error ? <p className="story-group-error">{error}</p> : null}
            {notice ? <p className="story-group-notice">{notice}</p> : null}

            {/* Create new group */}
            <div className="story-group-card">
              <h2 className="story-group-section-title">新建故事组</h2>
              <div className="story-group-create-row">
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="输入故事组名称…"
                  maxLength={80}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate()
                  }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={creating || !newGroupName.trim()}
                  onClick={() => void handleCreate()}
                >
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </div>

            {/* Story groups list */}
            {groups.map((group) => {
              const isRenaming = renamingGroupId === group.id
              const sessionsInGroup = groupedSessions.get(group.id) ?? []
              const isExpanded = expandedGroups.has(group.id)

              return (
                <div key={group.id} className="story-group-card story-group-item">
                  <div className="story-group-item-header">
                    <button
                      type="button"
                      className="story-group-expand-btn"
                      onClick={() => toggleExpand(group.id)}
                      aria-label={isExpanded ? '收起' : '展开'}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>

                    {isRenaming ? (
                      <div className="story-group-rename-row">
                        <input
                          value={renameInput}
                          onChange={(e) => setRenameInput(e.target.value)}
                          maxLength={80}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRename()
                            if (e.key === 'Escape') setRenamingGroupId(null)
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={savingRename || !renameInput.trim()}
                          onClick={() => void handleRename()}
                        >
                          {savingRename ? '…' : '保存'}
                        </button>
                        <button
                          type="button"
                          className="ghost btn-sm"
                          onClick={() => setRenamingGroupId(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="story-group-name-row">
                        <h3 className="story-group-name">{group.name}</h3>
                        <span className="story-group-count">{sessionsInGroup.length} 个窗口</span>
                      </div>
                    )}

                    {!isRenaming ? (
                      <div className="story-group-actions">
                        <button
                          type="button"
                          className="ghost btn-sm"
                          onClick={() => startRename(group)}
                        >
                          改名
                        </button>
                        <button
                          type="button"
                          className="ghost btn-sm danger-text"
                          onClick={() => setPendingDeleteGroup(group)}
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    <div className="story-group-sessions">
                      {sessionsInGroup.length === 0 ? (
                        <p className="story-group-empty">还没有归入窗口。</p>
                      ) : (
                        <ul className="story-group-session-list">
                          {sessionsInGroup.map((session) => (
                            <li key={session.id} className="story-group-session-item">
                              <div className="story-group-session-info">
                                <span className="story-group-session-title">
                                  {session.title || '未命名房间'}
                                </span>
                                <span className="story-group-session-time">
                                  {formatTime(session.createdAt)}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="ghost btn-sm"
                                onClick={() => void handleRemoveSession(session.id)}
                              >
                                移出
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}

            {/* Ungrouped sessions */}
            <div className="story-group-card">
              <h2 className="story-group-section-title">
                未分组 <span className="story-group-count">{ungroupedSessions.length} 个窗口</span>
              </h2>

              {ungroupedSessions.length === 0 ? (
                <p className="story-group-empty">所有窗口均已分组。</p>
              ) : (
                <ul className="story-group-session-list">
                  {ungroupedSessions.map((session) => (
                    <li key={session.id} className="story-group-session-item">
                      <div className="story-group-session-info">
                        <span className="story-group-session-title">
                          {session.title || '未命名房间'}
                        </span>
                        <span className="story-group-session-time">
                          {formatTime(session.createdAt)}
                        </span>
                      </div>

                      {assigningSessionId === session.id ? (
                        <div className="story-group-assign-picker">
                          {groups.length === 0 ? (
                            <span className="story-group-empty">请先创建故事组</span>
                          ) : (
                            groups.map((group) => (
                              <button
                                key={group.id}
                                type="button"
                                className="ghost btn-sm"
                                onClick={() => void handleAssignSession(session.id, group.id)}
                              >
                                {group.name}
                              </button>
                            ))
                          )}
                          <button
                            type="button"
                            className="ghost btn-sm"
                            onClick={() => setAssigningSessionId(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => setAssigningSessionId(session.id)}
                        >
                          归入故事组
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteGroup)}
        title="确认删除故事组？"
        description={pendingDeleteGroup ? `"${pendingDeleteGroup.name}" — 删除后仅解除关联，不会删除窗口本身。` : undefined}
        confirmLabel={deletingGroupId ? '删除中…' : '删除'}
        cancelLabel="取消"
        confirmDisabled={Boolean(deletingGroupId)}
        cancelDisabled={Boolean(deletingGroupId)}
        onCancel={() => setPendingDeleteGroup(null)}
        onConfirm={() => void handleDeleteGroup()}
      />
    </div>
  )
}

export default StoryGroupPage
