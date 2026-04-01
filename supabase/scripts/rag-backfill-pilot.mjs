#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'

const DEFAULT_PILOT_LIMIT = 5
const MEMORY_SOURCE_TABLE = 'memory_entries'

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_USER_ACCESS_TOKEN']
const missing = requiredEnv.filter((key) => !process.env[key])
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
const userAccessToken = process.env.SUPABASE_USER_ACCESS_TOKEN
const pilotLimitRaw = process.env.RAG_BACKFILL_PILOT_LIMIT
const pilotLimit = Number.isInteger(Number(pilotLimitRaw))
  ? Number(pilotLimitRaw)
  : DEFAULT_PILOT_LIMIT

if (pilotLimit !== DEFAULT_PILOT_LIMIT) {
  console.warn(
    `[warning] RAG_BACKFILL_PILOT_LIMIT=${pilotLimit}; this pilot script is intended to run with ${DEFAULT_PILOT_LIMIT} rows.`,
  )
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      apikey: supabaseAnonKey,
    },
  },
})

/**
 * Source query logic:
 * - read only memory_entries
 * - keep to non-deleted rows
 * - order by created_at for deterministic first-batch behavior
 * - hard limit to pilot size (default 5)
 */
const fetchPilotMemoryEntries = async (limit) => {
  const { data, error } = await supabase
    .from(MEMORY_SOURCE_TABLE)
    .select('id,user_id,content,source,status,created_at,updated_at,is_deleted')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to fetch ${MEMORY_SOURCE_TABLE}: ${error.message}`)
  }

  return data ?? []
}

/**
 * Row-to-payload mapping:
 * one memory_entries row => one rag-embed chunk with chunk_index=0
 */
const mapMemoryRowToEmbedItem = (row) => {
  const text = typeof row.content === 'string' ? row.content.trim() : ''
  if (!text) {
    return null
  }

  return {
    text,
    source: 'hamster-nest',
    zone: 'daily_chat',
    source_table: MEMORY_SOURCE_TABLE,
    source_id: String(row.id),
    chunk_index: 0,
    metadata: {
      memory_source: row.source ?? null,
      memory_status: row.status ?? null,
      memory_user_id: row.user_id ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    },
  }
}

/**
 * Call into rag-embed (unified ingestion path):
 * send batch payload using edge function invoke API.
 */
const ingestViaRagEmbed = async (items) => {
  if (items.length === 0) {
    return {
      processed: 0,
      inserted: 0,
      skipped: 0,
      failed: 0,
      results: [],
    }
  }

  const { data, error } = await supabase.functions.invoke('rag-embed', {
    body: {
      items,
    },
  })

  if (error) {
    throw new Error(`rag-embed invocation failed: ${error.message}`)
  }

  return {
    processed: Number(data?.processed ?? items.length),
    inserted: Number(data?.inserted ?? 0),
    skipped: Number(data?.skipped ?? 0),
    failed: Number(data?.failed ?? 0),
    results: Array.isArray(data?.results) ? data.results : [],
    raw: data,
  }
}

const run = async () => {
  const rows = await fetchPilotMemoryEntries(pilotLimit)

  // Pilot-size limiting and empty-text skipping happen before ingestion.
  const sourceIdsScanned = rows.map((row) => String(row.id))
  const items = []
  const skippedEmptySourceIds = []

  for (const row of rows) {
    const mapped = mapMemoryRowToEmbedItem(row)
    if (!mapped) {
      skippedEmptySourceIds.push(String(row.id))
      continue
    }
    items.push(mapped)
  }

  const ingestResult = await ingestViaRagEmbed(items)
  const ingestedSourceIds = ingestResult.results.map((item) => String(item.source_id))

  /**
   * Summary reporting:
   * compact counts + source ids for pilot traceability.
   */
  const summary = {
    source_table: MEMORY_SOURCE_TABLE,
    pilot_limit: pilotLimit,
    scanned_row_count: rows.length,
    attempted_item_count: items.length,
    inserted_count: ingestResult.inserted,
    skipped_count: ingestResult.skipped + skippedEmptySourceIds.length,
    failed_count: ingestResult.failed,
    scanned_source_ids: sourceIdsScanned,
    skipped_empty_text_source_ids: skippedEmptySourceIds,
    processed_source_ids: ingestedSourceIds,
    ready_for_full_memory_entries_backfill: true,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (ingestResult.failed > 0) {
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error('[rag-backfill-pilot] fatal error', error)
  process.exit(1)
})
