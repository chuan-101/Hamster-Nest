import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopControlReceipt, waitForDesktopControl } from '../src/lib/desktop-app-control.ts'

const row = (status, id = 'current') => ({ id, action: 'wake', status, created_at: '2026-09-15T00:00:00Z' })
const options = () => ({ id: 'current', signal: new AbortController().signal, pause: async () => {} })

test('historical wake is described as a receipt, never a live process state', () => {
  assert.deepEqual(desktopControlReceipt(row('executed')), { tone: 'green', label: '最近打开指令已执行' })
  assert.equal(desktopControlReceipt(null).label, '尚无桌面 App 指令记录')
})

test('polling confirms the requested command without realtime and survives transient read failure', async () => {
  let calls = 0
  const result = await waitForDesktopControl({ ...options(), read: async (id) => {
    assert.equal(id, 'current')
    calls++
    if (calls === 1) throw new Error('temporary network error')
    return row(calls === 2 ? 'pending' : 'executed')
  } })
  assert.equal(result.status, 'executed')
  assert.equal(calls, 3)
})

test('another command receipt cannot confirm this command, and waiting is bounded', async () => {
  let calls = 0
  const result = await waitForDesktopControl({ ...options(), attempts: 3, read: async () => {
    calls++
    return row('executed', 'other')
  } })
  assert.equal(result, null)
  assert.equal(calls, 3)
})

test('failed execution is returned as failure instead of timing out', async () => {
  const result = await waitForDesktopControl({ ...options(), read: async () => row('failed') })
  assert.equal(result.status, 'failed')
})

test('unmount or account change cancels polling and discards a late response', async () => {
  const controller = new AbortController()
  await assert.rejects(waitForDesktopControl({ ...options(), signal: controller.signal, read: async () => {
    controller.abort()
    return row('executed')
  } }), { name: 'AbortError' })
})

test('abort interrupts the normal polling delay', async () => {
  const controller = new AbortController()
  const waiting = waitForDesktopControl({ id: 'current', signal: controller.signal, read: async () => row('pending') })
  setTimeout(() => controller.abort(), 5)
  await assert.rejects(waiting, { name: 'AbortError' })
})
