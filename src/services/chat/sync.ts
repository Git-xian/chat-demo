import type { TranslationKey } from '../../i18n/index.js'

/**
 * 云端同步：只搬运导出的历史 ZIP，不接触 API Key、设置或浏览器里的任何消息数据。
 * 同步码既定位 R2 对象又充当凭证，存本机 localStorage；换设备时手动复制同一个码。
 * 因此它不能出现在导出归档里，也不随任何请求发往 DeepSeek。
 */

const CODE_KEY = 'chat-demo:sync-code'
const API = '/api/sync'

export type BackupMeta = {
  exists: boolean
  size?: number
  updatedAt?: number
}

/** 同步失败的可预期原因，用于界面提示；网络/服务端异常统一归为 failed。 */
export type SyncErrorReason =
  | 'syncErrorInvalidCode'
  | 'syncErrorNotFound'
  | 'syncErrorTooLarge'
  | 'syncErrorFailed'

export class SyncError extends Error {
  constructor(readonly reason: SyncErrorReason) {
    super(reason)
  }
}

export const loadSyncCode = (): string => {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export const saveSyncCode = (code: string): void => {
  try {
    if (code) {
      localStorage.setItem(CODE_KEY, code)
    } else {
      localStorage.removeItem(CODE_KEY)
    }
  } catch {
    // 存储不可用时仅本次会话有效
  }
}

/** 32 位十六进制同步码，够随机、又便于跨设备复制。 */
export const generateSyncCode = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const code = loadSyncCode()
  if (!code) {
    throw new SyncError('syncErrorInvalidCode')
  }
  let response: Response
  try {
    response = await fetch(`${API}/${path}`, {
      ...init,
      headers: { 'X-Sync-Code': code, ...init.headers },
    })
  } catch {
    throw new SyncError('syncErrorFailed')
  }
  if (!response.ok) {
    throw new SyncError(errorReason(response.status))
  }
  return response
}

const errorReason = (status: number): SyncErrorReason => {
  if (status === 400) {
    return 'syncErrorInvalidCode'
  }
  if (status === 404) {
    return 'syncErrorNotFound'
  }
  if (status === 413) {
    return 'syncErrorTooLarge'
  }
  return 'syncErrorFailed'
}

export const fetchBackupMeta = async (): Promise<BackupMeta> => {
  const response = await request('meta')
  return (await response.json()) as BackupMeta
}

/** 上传整份历史归档；blob 由现有的 exportHistory 生成，格式与手动导出完全一致。 */
export const uploadBackup = async (blob: Blob): Promise<number> => {
  const response = await request('upload', {
    method: 'PUT',
    body: blob,
    headers: { 'content-type': 'application/zip' },
  })
  const result = (await response.json()) as { updatedAt: number }
  return result.updatedAt
}

/** 下载归档并交给现有的 importHistory：确认覆盖、暂存校验、原子替换全部复用。 */
export const downloadBackup = async (): Promise<File> => {
  const response = await request('download')
  const blob = await response.blob()
  return new File([blob], 'deepseek_data-sync.zip', { type: 'application/zip' })
}

export const syncErrorKey = (error: unknown): TranslationKey =>
  error instanceof SyncError ? error.reason : 'syncErrorFailed'
