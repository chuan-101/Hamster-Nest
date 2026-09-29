import test from 'node:test'
import assert from 'node:assert/strict'
import { isDiaryQuietTime } from '../supabase/functions/push-dispatch/diary-policy.ts'

test('diary uses weekday 23:45 and weekend-night 00:30 sleep boundaries', () => {
  for (const [time, quiet] of [
    ['2026-09-29T23:44:00+08:00', false], ['2026-09-29T23:45:00+08:00', true],
    ['2026-09-26T23:59:00+08:00', false], ['2026-09-27T00:29:00+08:00', false],
    ['2026-09-27T00:30:00+08:00', true], ['2026-09-27T07:59:00+08:00', true],
    ['2026-09-27T08:00:00+08:00', false],
    ['2026-09-25T23:59:00+08:00', false], ['2026-09-26T00:29:00+08:00', false],
    ['2026-09-26T00:30:00+08:00', true], ['2026-09-27T23:44:00+08:00', false],
    ['2026-09-27T23:45:00+08:00', true], ['2026-09-28T00:10:00+08:00', true],
  ]) assert.equal(isDiaryQuietTime(new Date(time)), quiet, time)
})
