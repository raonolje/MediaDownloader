const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

function probe(exe, file) {
  return new Promise((resolve, reject) => {
    execFile(exe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { windowsHide: true, encoding: 'utf8', timeout: 30000 }, (error, stdout) => {
        if (error) return reject(error);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
  });
}

async function encodeForPremiere(source, ffmpeg, ffprobe, onProgress, onLog) {
  const info = await probe(ffprobe, source);
  if (!info.streams.some(s => s.codec_type === 'video')) throw new Error('영상 트랙이 없습니다.');
  const hasAudio = info.streams.some(s => s.codec_type === 'audio');
  const duration = Number(info.format.duration) || 0;
  const stem = path.join(path.dirname(source), path.basename(source, path.extname(source)));
  let destination = stem + '.mp4';
  // Never replace an unrelated MP4 beside a downloaded WebM/MKV.
  if (destination.toLowerCase() !== source.toLowerCase() && fs.existsSync(destination)) {
    let suffix = 1;
    do { destination = `${stem} (H264 ${suffix++}).mp4`; } while (fs.existsSync(destination));
  }
  const temporary = path.join(path.dirname(source), `.mdl-${crypto.randomUUID()}.mp4`);
  try {
    onProgress(0);
    await new Promise((resolve, reject) => {
      const args = ['-hide_banner', '-nostdin', '-n', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', temporary];
      const proc = spawn(ffmpeg, args, { windowsHide: true });
      let pending = '';
      let errorTail = '';
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          const m = line.match(/^out_time_us=(\d+)/);
          if (m && duration > 0) onProgress(Math.min(99, Number(m[1]) / 1000000 / duration * 100));
        }
      });
      proc.stderr.on('data', text => { errorTail = (errorTail + text).slice(-3000); onLog(text); });
      proc.on('error', reject);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`H.264 인코딩 실패 (${code}): ${errorTail}`)));
    });
    const encoded = await probe(ffprobe, temporary);
    const video = encoded.streams.find(s => s.codec_type === 'video');
    const audio = encoded.streams.find(s => s.codec_type === 'audio');
    if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
        (hasAudio && (!audio || audio.codec_name !== 'aac')) || fs.statSync(temporary).size === 0) {
      throw new Error('H.264/AAC 출력 검증에 실패했습니다.');
    }
    // Keep the download intact until encoding and validation have both succeeded.
    fs.renameSync(temporary, destination);
    if (source.toLowerCase() !== destination.toLowerCase()) {
      try { fs.unlinkSync(source); } catch (e) { onLog(`원본 정리 실패: ${e.message}\n`); }
    }
    return path.basename(destination);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
}

module.exports = { encodeForPremiere };
