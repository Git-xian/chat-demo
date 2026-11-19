import { useEffect, useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { IconDownloadOutline16, IconUploadOutline14 } from '../base/icons.js'
import { useTranslate, type TranslationKey, type TranslationParams } from '../../i18n/index.js'
import { exportHistory, importHistory } from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  downloadBackup,
  fetchBackupMeta,
  generateSyncCode,
  loadSyncCode,
  saveSyncCode,
  syncErrorKey,
  uploadBackup,
  type BackupMeta,
} from '../../services/chat/sync.js'
import styles from './Settings.module.css'

const CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

type Status = { key: TranslationKey; params?: TranslationParams; error?: boolean } | null
type Busy = 'upload' | 'download' | 'restore' | null

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString()

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`

/**
 * 云端同步区块：同步码存本机，聊天记录以现有 ZIP 格式上传/恢复到 R2。
 * 只搬运历史归档，API Key 与其他设置始终留在浏览器，不进入任何导出或请求。
 */
export const SyncSetting = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [code, setCode] = useState(loadSyncCode)
  const [meta, setMeta] = useState<BackupMeta | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const codeValid = CODE_PATTERN.test(code)

  // 同步码合法时查询云端现状；切换码或上传后刷新。
  useEffect(() => {
    if (!codeValid) {
      setMeta(null)
      return
    }
    let active = true
    void fetchBackupMeta()
      .then((result) => {
        if (active) {
          setMeta(result)
        }
      })
      .catch(() => {
        if (active) {
          setMeta(null)
        }
      })
    return () => {
      active = false
    }
  }, [code, codeValid])

  const onGenerate = () => {
    const next = generateSyncCode()
    saveSyncCode(next)
    setCode(next)
    setMeta(null)
    setStatus({ key: 'cloudSyncSaved' })
  }

  const onCodeChange = (value: string) => {
    const next = value.trim()
    saveSyncCode(next)
    setCode(next)
    setStatus(null)
  }

  const onUpload = async () => {
    setBusy('upload')
    setStatus(null)
    try {
      const { blob } = await exportHistory()
      const updatedAt = await uploadBackup(blob)
      setMeta({ exists: true, size: blob.size, updatedAt })
      setStatus({ key: 'cloudSyncUploaded', params: { time: formatTime(updatedAt) } })
    } catch (error) {
      setStatus({ key: syncErrorKey(error), error: true })
    } finally {
      setBusy(null)
    }
  }

  const onDownload = async () => {
    setBusy('download')
    setStatus(null)
    try {
      setPendingFile(await downloadBackup())
    } catch (error) {
      setStatus({ key: syncErrorKey(error), error: true })
    } finally {
      setBusy(null)
    }
  }

  const onRestoreConfirm = async () => {
    if (!pendingFile) {
      return
    }
    setBusy('restore')
    setStatus(null)
    try {
      const count = await importHistory(pendingFile)
      setPendingFile(null)
      setStatus({ key: 'cloudSyncRestored', params: { count } })
    } catch {
      setStatus({ key: 'syncErrorFailed', error: true })
    } finally {
      setBusy(null)
    }
  }

  const description = meta?.exists
    ? t('cloudSyncMetaExists', {
        size: formatSize(meta.size ?? 0),
        time: formatTime(meta.updatedAt ?? 0),
      })
    : meta
      ? t('cloudSyncMetaNone')
      : t('cloudSyncDescription')

  const working = busy !== null

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.apiKey}>
          <div className={styles.label}>{t('cloudSyncLabel')}</div>
          <div className={styles.description}>{description}</div>
          <div className={styles.apiKeyInput}>
            <input
              type="text"
              value={code}
              placeholder={t('cloudSyncCodePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              disabled={working || disabled}
              onChange={(event) => onCodeChange(event.target.value)}
            />
            <span className={styles.divider} />
            <button
              type="button"
              className={styles.confirm}
              disabled={working || disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onGenerate}
            >
              {t('cloudSyncGenerate')}
            </button>
          </div>
          <div className={styles.description}>{t('cloudSyncCodeHint')}</div>
          {code && !codeValid ? <div className={styles.error}>{t('cloudSyncInvalidCode')}</div> : null}
          {status ? (
            <div className={status.error ? styles.error : styles.description}>
              {t(status.key, status.params)}
            </div>
          ) : null}
          <div className={styles.syncActions}>
            <Button
              variant="outlined"
              size="m"
              disabled={disabled || working || !codeValid || empty}
              onClick={() => void onUpload()}
            >
              <IconUploadOutline14 />
              {t(busy === 'upload' ? 'cloudSyncUploading' : 'cloudSyncUpload')}
            </Button>
            <Button
              variant="outlined"
              size="m"
              disabled={disabled || working || !codeValid}
              onClick={() => void onDownload()}
            >
              <IconDownloadOutline16 />
              {t(busy === 'download' ? 'cloudSyncDownloading' : 'cloudSyncDownload')}
            </Button>
          </div>
          <div className={styles.description}>{t('cloudSyncNeedDeploy')}</div>
        </div>
      </div>
      {pendingFile ? (
        <Modal
          title={t('cloudSyncRestoreTitle')}
          className={styles.importConfirm}
          onClose={() => setPendingFile(null)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setPendingFile(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                disabled={busy === 'restore'}
                onClick={() => void onRestoreConfirm()}
              >
                {t('cloudSyncRestoreConfirm')}
              </Button>
            </>
          }
        >
          <div className={styles.importConfirmText}>{t('cloudSyncRestoreDescription')}</div>
        </Modal>
      ) : null}
    </>
  )
}
