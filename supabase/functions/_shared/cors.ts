// 浏览器前端的跨域白名单：原站 + 本地开发，外加 HAMSTER_ALLOWED_ORIGINS
// （逗号分隔的完整 origin，如 https://someone.github.io）。Fork 部署只需设这个
// secret，不用改代码；未设置时行为与原先一致。

export const PRIMARY_BROWSER_ORIGIN = 'https://chuan-101.github.io'

const DEFAULT_ALLOWED_ORIGINS: ReadonlyArray<string | RegExp> = [
  PRIMARY_BROWSER_ORIGIN,
  /^http:\/\/localhost:\d+$/u,
  /^http:\/\/127\.0\.0\.1:\d+$/u,
]

export const parseAllowedOrigins = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/u, ''))
    .filter((value) => value.length > 0)

const readExtraOrigins = (): string[] => {
  const deno = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno
  try {
    return parseAllowedOrigins(deno?.env?.get?.('HAMSTER_ALLOWED_ORIGINS'))
  } catch {
    return []
  }
}

export const isAllowedBrowserOrigin = (
  origin: string,
  extraOrigins: readonly string[] = readExtraOrigins(),
) =>
  extraOrigins.includes(origin) ||
  DEFAULT_ALLOWED_ORIGINS.some((candidate) =>
    typeof candidate === 'string' ? candidate === origin : candidate.test(origin)
  )
