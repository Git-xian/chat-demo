/**
 * 云端同步后端：把前端导出的历史 ZIP 存进 R2。
 *
 * 「同步码」既是定位对象的 key，也是唯一凭证：服务端不保存任何用户身份，
 * 拿到同一个同步码的设备才能读写同一份备份。因此同步码必须足够随机，
 * 由前端用 crypto.randomUUID 生成，用户只在同一账号的不同设备间手动复制。
 */

type BackupObject = {
  body: ReadableStream
  size: number
  uploaded: Date
}

type R2Binding = {
  get(key: string, options?: { onlyHead?: boolean }): Promise<BackupObject | null>
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: Record<string, string> }
  ): Promise<unknown>
}

type AssetsBinding = {
  fetch(request: Request): Promise<Response>
}

type Env = {
  BACKUP: R2Binding
  ASSETS: AssetsBinding
}

const API_PREFIX = '/api/sync/'
const CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // 非同步接口一律交给静态资源，保持原有单页应用行为。
    if (!url.pathname.startsWith(API_PREFIX)) {
      return env.ASSETS.fetch(request)
    }

    const code = request.headers.get('X-Sync-Code') ?? ''
    if (!CODE_PATTERN.test(code)) {
      return json({ error: 'invalid_code' }, 400)
    }

    const key = `sync/${code}.zip`
    const action = url.pathname.slice(API_PREFIX.length)

    if (action === 'meta' && request.method === 'GET') {
      const object = await env.BACKUP.get(key, { onlyHead: true })
      if (!object) {
        return json({ exists: false })
      }
      const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : 0
      return json({ exists: true, size: object.size, updatedAt: Number.isFinite(uploaded) ? uploaded : 0 })
    }

    if (action === 'upload' && request.method === 'PUT') {
      if (!request.body) {
        return json({ error: 'empty_body' }, 400)
      }
      // 流式写入，不在 Worker 内存里缓存整份备份。
      await env.BACKUP.put(key, request.body, {
        httpMetadata: { contentType: 'application/zip' },
      })
      return json({ ok: true, updatedAt: Date.now() })
    }

    if (action === 'download' && request.method === 'GET') {
      const object = await env.BACKUP.get(key)
      if (!object) {
        return json({ error: 'not_found' }, 404)
      }
      return new Response(object.body, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="deepseek_data.zip"',
          'cache-control': 'no-store',
          'content-length': String(object.size),
        },
      })
    }

    return json({ error: 'not_found' }, 404)
  },
}
