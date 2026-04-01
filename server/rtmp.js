/**
 * rtmp.js — RTMP live-streaming ingest server.
 *
 * Requires: node-media-server  (npm install node-media-server)
 *           ffmpeg              (apt install ffmpeg)
 *
 * When a user starts a stream the flow is:
 *   1. prePublish  — validate stream_key against users table, reject if invalid
 *   2. postPublish — insert row in livestreams, start ffmpeg recording
 *   3. donePublish — stop recording, call createReelFromLivestream()
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { createReelFromLivestream } from './livestream.js'

const UPLOADS_DIR   = process.env.UPLOADS_DIR || '/var/www/fellis.eu/uploads'
export const RTMP_PORT = parseInt(process.env.RTMP_PORT, 10) || 1935

// { sessionId → { livestreamId, userId, recordingPath, ffmpegProc, startedAt } }
const activeStreams = new Map()

/**
 * Try to load node-media-server dynamically so the server still boots
 * when the package is not installed.
 */
async function loadNms() {
  try {
    const mod = await import('node-media-server')
    return mod.default ?? mod
  } catch {
    return null
  }
}

/**
 * Start the RTMP ingest server.
 * Returns the NodeMediaServer instance, or null if NMS is unavailable.
 *
 * @param {import('mysql2/promise').Pool} pool  MySQL2 pool
 */
export async function startRtmpServer(pool) {
  const NodeMediaServer = await loadNms()
  if (!NodeMediaServer) {
    console.warn('[rtmp] node-media-server not found — RTMP server not started.')
    console.warn('[rtmp] Run: cd server && npm install node-media-server')
    return null
  }

  const config = {
    logType: 1, // 1 = error only (quiet)
    rtmp: {
      port:         RTMP_PORT,
      chunk_size:   60000,
      gop_cache:    true,
      ping:         30,
      ping_timeout: 60,
    },
    // No built-in HTTP/HLS — we handle everything ourselves
  }

  const nms = new NodeMediaServer(config)

  // ── prePublish: authenticate stream key ─────────────────────────────────────
  nms.on('prePublish', async (id, StreamPath) => {
    const streamKey = StreamPath.split('/').pop()
    const session   = nms.getSession(id)
    try {
      const [[user]] = await pool.query(
        'SELECT id FROM users WHERE stream_key = ? AND deleted_at IS NULL LIMIT 1',
        [streamKey]
      )
      if (!user) {
        console.warn('[rtmp] Rejected unknown stream key:', streamKey)
        session.reject()
        return
      }

      // Check platform enabled flag
      const [[setting]] = await pool.query(
        "SELECT key_value FROM admin_settings WHERE key_name = 'livestream_enabled'"
      ).catch(() => [[null]])
      if (setting?.key_value !== '1') {
        console.warn('[rtmp] Live streaming disabled — rejecting stream from user', user.id)
        session.reject()
        return
      }

      // Record intent so postPublish can find the user
      activeStreams.set(id, { userId: user.id, streamKey })
    } catch (err) {
      console.error('[rtmp] prePublish error:', err.message)
      session.reject()
    }
  })

  // ── postPublish: create DB record + start ffmpeg recording ──────────────────
  nms.on('postPublish', async (id, StreamPath) => {
    const info = activeStreams.get(id)
    if (!info) return

    try {
      const [result] = await pool.query(
        "INSERT INTO livestreams (user_id, status, started_at) VALUES (?, 'live', NOW())",
        [info.userId]
      )
      info.livestreamId = result.insertId

      const recordingPath = path.join(UPLOADS_DIR, `live-${info.livestreamId}.mp4`)
      info.recordingPath  = recordingPath

      // Pull the stream back from the RTMP server and record to file
      const internalUrl = `rtmp://127.0.0.1:${RTMP_PORT}${StreamPath}`
      const proc = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', internalUrl,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y', recordingPath,
      ])
      info.ffmpegProc = proc

      proc.on('error', err => {
        console.error('[rtmp] ffmpeg recording error:', err.message)
      })
      proc.stderr.on('data', d => {
        const msg = d.toString().trim()
        if (msg) console.error('[rtmp] ffmpeg:', msg)
      })

      console.log(`[rtmp] Stream started: user ${info.userId}, livestream #${info.livestreamId}`)
    } catch (err) {
      console.error('[rtmp] postPublish error:', err.message)
    }
  })

  // ── donePublish: stop recording + create reel ────────────────────────────────
  nms.on('donePublish', async (id) => {
    const info = activeStreams.get(id)
    if (!info) return
    activeStreams.delete(id)

    try {
      await pool.query(
        "UPDATE livestreams SET status = 'ended', ended_at = NOW() WHERE id = ?",
        [info.livestreamId]
      )

      // Stop ffmpeg gracefully (send 'q' to stdin)
      if (info.ffmpegProc) {
        await new Promise(resolve => {
          info.ffmpegProc.on('close', resolve)
          try { info.ffmpegProc.stdin.write('q') } catch { info.ffmpegProc.kill('SIGTERM') }
          // Force kill after 10 s if it hasn't exited
          setTimeout(() => { try { info.ffmpegProc.kill('SIGKILL') } catch {} }, 10_000)
        })
      }

      // Create reel if recording file exists
      if (info.recordingPath && fs.existsSync(info.recordingPath)) {
        const result = await createReelFromLivestream({
          userId:        info.userId,
          livestreamId:  info.livestreamId,
          recordingPath: info.recordingPath,
          uploadsDir:    UPLOADS_DIR,
          pool,
        })
        if (result) {
          console.log(`[rtmp] Reel #${result.reelId} created from livestream #${info.livestreamId}`)
        }
      } else {
        console.warn(`[rtmp] Recording not found at ${info.recordingPath}`)
      }
    } catch (err) {
      console.error('[rtmp] donePublish error:', err.message)
    }
  })

  nms.run()
  console.log(`[rtmp] RTMP server listening on rtmp://0.0.0.0:${RTMP_PORT}/live`)
  return nms
}
