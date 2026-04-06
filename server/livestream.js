/**
 * livestream.js — Automatic Reel creation from ended live streams.
 *
 * After FFmpeg encodes a live recording to MP4:
 *  1. Reads admin_settings for reel_max_duration_seconds (default 600 = 10 min)
 *  2. If recording exceeds limit: trims to first reel_max_duration_seconds via FFmpeg
 *  3. INSERTs into reels table: user_id, video_url, source='live', title_da, title_en
 *  4. Updates livestreams.reel_file_url with the final path
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

const DEFAULT_REEL_MAX_SECONDS = 600    // 10 minutes
const DEFAULT_STREAM_MAX_SECONDS = 3600 // 60 minutes

/**
 * Read a numeric setting from admin_settings, returning defaultVal if unset/invalid.
 */
async function getAdminSetting(pool, keyName, defaultVal) {
  try {
    const [[row]] = await pool.query(
      'SELECT key_value FROM admin_settings WHERE key_name = ?',
      [keyName]
    )
    const v = parseInt(row?.key_value, 10)
    return Number.isFinite(v) && v > 0 ? v : defaultVal
  } catch {
    return defaultVal
  }
}

/**
 * Get the duration of a media file in seconds using ffprobe.
 * Returns null if ffprobe is unavailable or fails.
 */
async function getFileDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath,
    ])
    const info = JSON.parse(stdout)
    const stream = info.streams?.find(s => s.codec_type === 'video' || s.duration)
    const dur = parseFloat(stream?.duration)
    return Number.isFinite(dur) ? dur : null
  } catch {
    return null
  }
}

/**
 * Trim a video file to maxSeconds using FFmpeg.
 * Writes to a new file with suffix "_trimmed" and returns the new path.
 * Returns the original path if FFmpeg is unavailable or the trim fails.
 */
async function trimVideo(inputPath, maxSeconds) {
  const ext = path.extname(inputPath)
  const base = inputPath.slice(0, inputPath.length - ext.length)
  const outputPath = `${base}_trimmed${ext}`
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-t', String(maxSeconds),
      '-c', 'copy',
      outputPath,
    ])
    return outputPath
  } catch (err) {
    console.error('[livestream] ffmpeg trim failed:', err.message)
    return inputPath // fall back to original if trim fails
  }
}

/**
 * Create a reel from a completed livestream recording.
 *
 * @param {object} opts
 * @param {number}  opts.userId        — streamer's user ID
 * @param {number}  opts.livestreamId  — row ID in livestreams table (may be null)
 * @param {string}  opts.recordingPath — absolute path to the encoded MP4
 * @param {string}  opts.uploadsDir    — absolute path to the uploads dir (e.g. /var/www/.../uploads)
 * @param {object}  opts.pool          — MySQL2 connection pool
 * @returns {Promise<{reelId: number, fileUrl: string}|null>}
 */
export async function createReelFromLivestream({ userId, livestreamId, recordingPath, uploadsDir, pool }) {
  try {
    // 1. Read duration limit from admin_settings
    const reelMaxSeconds = await getAdminSetting(pool, 'reel_max_duration_seconds', DEFAULT_REEL_MAX_SECONDS)

    // 2. Determine actual file to use (trim if needed)
    let finalPath = recordingPath
    const duration = await getFileDuration(recordingPath)
    if (duration !== null && duration > reelMaxSeconds) {
      console.log(`[livestream] Recording is ${Math.round(duration)}s, trimming to ${reelMaxSeconds}s`)
      finalPath = await trimVideo(recordingPath, reelMaxSeconds)
    }

    // 3. Derive a URL path relative to uploadsDir
    const filename = path.basename(finalPath)
    // Ensure file is inside uploads dir (copy if trim produced it in a different location)
    const targetPath = path.join(uploadsDir, filename)
    if (finalPath !== targetPath && fs.existsSync(finalPath) && !fs.existsSync(targetPath)) {
      fs.copyFileSync(finalPath, targetPath)
    }
    const fileUrl = `/uploads/${filename}`

    // 4. Build bilingual titles
    const now = new Date()
    const dateDa = now.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })
    const dateEn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const titleDa = `Livestream ${dateDa}`
    const titleEn = `Livestream ${dateEn}`

    // 5. INSERT into reels
    const [result] = await pool.query(
      `INSERT INTO reels (user_id, video_url, source, title_da, title_en, created_at)
       VALUES (?, ?, 'live', ?, ?, NOW())`,
      [userId, fileUrl, titleDa, titleEn]
    ).catch(() =>
      // Fallback if new columns don't exist yet (schema not migrated)
      pool.query(
        `INSERT INTO reels (user_id, video_url, created_at) VALUES (?, ?, NOW())`,
        [userId, fileUrl]
      )
    )

    const reelId = result.insertId
    console.log(`[livestream] Created reel #${reelId} for user ${userId} from livestream`)

    // 6. Update livestreams.reel_file_url if livestreamId provided
    if (livestreamId) {
      await pool.query(
        'UPDATE livestreams SET reel_file_url = ? WHERE id = ?',
        [fileUrl, livestreamId]
      ).catch(err => console.warn('[livestream] Could not update livestreams.reel_file_url:', err.message))
    }

    return { reelId, fileUrl }
  } catch (err) {
    console.error('[livestream] createReelFromLivestream error:', err.message)
    return null
  }
}

export const LIVESTREAM_DEFAULTS = {
  reel_max_duration_seconds: DEFAULT_REEL_MAX_SECONDS,
  streaming_max_duration_seconds: DEFAULT_STREAM_MAX_SECONDS,
}

/**
 * Transcode a video file to H.264/AAC MP4 for universal browser compatibility.
 * Replaces the original file in-place. Returns the (unchanged) filePath on success
 * or if FFmpeg is unavailable, so callers can always proceed with the original.
 *
 * @param {string} filePath — absolute path to the uploaded video file
 * @returns {Promise<string>} — filePath (same path, transcoded in-place)
 */
export async function transcodeVideo(filePath) {
  const base = filePath.replace(/\.[^.]+$/, '')
  const tmpPath = `${base}.transcoding.mp4`
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      tmpPath,
    ])
    fs.renameSync(tmpPath, filePath)
    console.log(`[transcode] Transcoded ${path.basename(filePath)} to H.264/AAC`)
  } catch (err) {
    console.warn(`[transcode] FFmpeg unavailable or failed for ${path.basename(filePath)}: ${err.message}`)
    try { fs.unlinkSync(tmpPath) } catch {}
    // Fall through — serve original file as-is
  }
  return filePath
}
