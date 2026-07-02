# Mini Agent 任务单：signal-bus-consumer 共享密钥鉴权同步

## 背景

`signal-bus-consumer` Edge Function 已改为保留 `verify_jwt=false`，但在 `OPTIONS` 之后、正式处理 `POST` 之前校验共享密钥：

- Supabase Edge Function 环境变量：`SIGNAL_BUS_SECRET`
- 请求头：`x-signal-bus-secret: <同一段密钥>`
- fail-closed：未配置、未传、或不匹配都返回 `401 Unauthorized`

Mini 机上的执行层需要与线上函数同批更新，否则定时投递会因为缺少 `x-signal-bus-secret` 被拒绝。

## 目标

把 Mini 机上所有调用远端 `signal-bus-consumer` 的位置统一改成使用 `SIGNAL_BUS_SECRET`，并确保定时投递、手动触发、重试/补偿触发三类入口都带上 `x-signal-bus-secret`。

## 变更范围

### 1. 环境变量

在 Mini 机的本地运行环境中新增：

```dotenv
SIGNAL_BUS_SECRET=<与 Supabase secrets 中 SIGNAL_BUS_SECRET 完全一致的随机长串>
```

建议位置：

```text
/Users/syzygy/mini-agent/.env
```

要求：

- 不要把真实值提交到 git。
- 不要复用 Supabase service role key。
- 用一段独立的随机长串，例如 32 bytes 以上随机值。
- Mini Agent 启动时必须读取该变量；读不到时应 fail-closed，不要静默裸请求。

### 2. 调用代码

搜索 Mini Agent 代码库中的所有 signal-bus 调用：

```bash
rg -n "signal-bus-consumer|signal-bus|SIGNAL_BUS|supabase\.co/functions/v1" /Users/syzygy/mini-agent
```

对所有调用 `https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/signal-bus-consumer` 的请求加 header：

```http
x-signal-bus-secret: ${SIGNAL_BUS_SECRET}
```

如果是 `fetch`：

```ts
const signalBusSecret = process.env.SIGNAL_BUS_SECRET
if (!signalBusSecret) {
  throw new Error('SIGNAL_BUS_SECRET is required for signal-bus-consumer')
}

await fetch('https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/signal-bus-consumer', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-signal-bus-secret': signalBusSecret,
  },
  body: JSON.stringify({ limit: 20 }),
})
```

如果是 `curl` / shell：

```bash
: "${SIGNAL_BUS_SECRET:?SIGNAL_BUS_SECRET is required}"

curl --fail --show-error --silent \
  --request POST \
  --url 'https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/signal-bus-consumer' \
  --header "x-signal-bus-secret: ${SIGNAL_BUS_SECRET}" \
  --header 'Content-Type: application/json' \
  --data '{"limit":20}'
```

### 3. 三处入口必须同批上线

请确认并同步修改 Mini 机执行层里的三类入口：

1. 定时任务入口：按固定频率消费 pending signals。
2. 手动/调试入口：手动触发 signal-bus 消费的脚本或命令。
3. 重试/补偿入口：失败重跑、补投递、或恢复任务时调用 signal-bus 的路径。

验收时请贴出三处文件路径与行号，确认它们都读取同一个 `SIGNAL_BUS_SECRET` 并传入 `x-signal-bus-secret`。

## 上线顺序

1. 在 Supabase Edge Function secrets 中设置 `SIGNAL_BUS_SECRET`。
2. 在 GitHub Secrets 中设置同名 `SIGNAL_BUS_SECRET`，用于 GitHub Actions cron。
3. 在 Mini 机 `/Users/syzygy/mini-agent/.env` 中设置同名 `SIGNAL_BUS_SECRET`。
4. 部署新版 `signal-bus-consumer` Edge Function。
5. 部署/重启 Mini Agent。
6. 触发一次手动消费，确认返回 2xx。
7. 观察下一轮定时投递日志，确认无 401。

> 注意：第 1、2、3 步里的 secret 值必须一致。第 4、5 步尽量同批完成，避免定时投递短暂中断。

## 验收命令

### 环境变量存在性

```bash
cd /Users/syzygy/mini-agent
set -a
source .env
set +a
test -n "$SIGNAL_BUS_SECRET"
```

### 裸请求必须失败

```bash
curl --silent --show-error --write-out '\n%{http_code}\n' \
  --request POST \
  --url 'https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/signal-bus-consumer' \
  --header 'Content-Type: application/json' \
  --data '{"limit":1}'
```

预期：`401`。

### 带共享密钥请求必须成功

```bash
curl --fail --show-error --silent --write-out '\n%{http_code}\n' \
  --request POST \
  --url 'https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/signal-bus-consumer' \
  --header "x-signal-bus-secret: ${SIGNAL_BUS_SECRET}" \
  --header 'Content-Type: application/json' \
  --data '{"limit":1}'
```

预期：`2xx`。

### 代码侧无裸调用残留

```bash
rg -n "signal-bus-consumer|signal-bus|SUPABASE_SERVICE_KEY|Authorization: Bearer" /Users/syzygy/mini-agent
```

确认所有 `signal-bus-consumer` 调用都带 `x-signal-bus-secret`，并且不再用 Supabase service role key 作为 HTTP 调用口令。

## 回滚方案

如果上线后投递异常：

1. 先检查 Mini Agent 日志是否出现 `401 Unauthorized`。
2. 检查 Supabase secrets、GitHub Secrets、Mini 机 `.env` 三处 `SIGNAL_BUS_SECRET` 是否一致。
3. 确认 Mini Agent 进程已重启并加载新 `.env`。
4. 不建议回滚到 service role bearer 调用；若必须临时止血，应限制时间窗口并随后恢复共享密钥方案。

## 完成标准

- Mini 机三处 signal-bus 调用均带 `x-signal-bus-secret`。
- `SIGNAL_BUS_SECRET` 缺失时本地调用 fail-closed。
- 裸请求线上返回 `401`。
- 带共享密钥请求线上返回 `2xx`。
- 下一轮定时任务无 401，且 pending signals 能正常被处理。
