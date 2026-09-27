export type Sofa = { id: string; name: string; session_id: string; kind: string; created_at: string; updated_at?: string }
export type LoungeSession = { id: string; conversation_kind: string; handler: string; is_archived: boolean | null; routing_config: { sofa_id?: string; rules_prompt_name?: string } | null }
export type LoungeRule = { id: string; name: string; version: number; content: string }

// Input rows must already be owner-scoped. Names and updated_at never decide routing.
export function loungeTargets(sofas: Sofa[], sessions: LoungeSession[], rules: LoungeRule[]) {
  const targets = sofas.flatMap(sofa => {
    const session = sessions.find(row => row.id === sofa.session_id)
    if (!session || session.is_archived || session.handler !== 'router' || session.conversation_kind !== 'group' || session.routing_config?.sofa_id !== sofa.id) return []
    const ruleName = session.routing_config.rules_prompt_name
    if (!['sofa_daily_rules', 'sofa_work_rules'].includes(ruleName ?? '')) return []
    const matchingRules = rules.filter(row => row.name === ruleName)
    if (matchingRules.length !== 1 || !matchingRules[0].content.trim()) return []
    return [{ ...sofa, rules: matchingRules[0], is_default_casual: false }]
  }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
  const latest = targets.find(row => ['daily', 'custom'].includes(row.kind) && row.rules.name === 'sofa_daily_rules')
  if (latest) latest.is_default_casual = true
  return targets
}

export function resolveLoungeTarget(targets: ReturnType<typeof loungeTargets>, { sofaId, replySessionId }: { sofaId?: string; replySessionId?: string }) {
  const target = sofaId ? targets.find(row => row.id === sofaId)
    : replySessionId ? targets.find(row => row.session_id === replySessionId)
    : targets.find(row => row.is_default_casual)
  if (!target) throw new Error('No valid lounge target with an active rule binding')
  if (replySessionId && target.session_id !== replySessionId) throw new Error('Explicit sofa conflicts with the reply message; refusing to redirect')
  return target
}
