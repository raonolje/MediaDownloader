const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { encodeForPremiere } = require('../premiere');

const ffmpeg = process.env.FFMPEG_PATH || path.join(__dirname, '..', 'vendor', 'ffmpeg.exe');
const ffprobe = process.env.FFPROBE_PATH || path.join(path.dirname(ffmpeg), 'ffprobe.exe');
const available = fs.existsSync(ffmpeg) && fs.existsSync(ffprobe);
const run = (exe, args) => execFileSync(exe, args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('Premiere encoding with real FFmpeg', { skip: !available }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdl-codec-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases = [
    ['AV1 Opus', 'mkv', ['-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '40', '-b:v', '0', '-c:a', 'libopus'], true],
    ['VP9 Opus', 'webm', ['-c:v', 'libvpx-vp9', '-c:a', 'libopus'], true],
    ['HEVC 10 bit', 'mkv', ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', '-c:a', 'aac'], true],
    ['H264 AAC', 'mp4', ['-c:v', 'libx264', '-c:a', 'aac'], true],
    ['odd dimensions silent', 'mkv', ['-c:v', 'ffv1'], false],
  ];
  for (const [name, ext, codec, audio] of cases) {
    await t.test(name, async () => {
      const source = path.join(dir, `한글 & ${name}.${ext}`);
      const inputs = ['-f', 'lavfi', '-i', audio ? 'testsrc2=size=160x90:rate=24' : 'testsrc=size=161x91:rate=24'];
      if (audio) inputs.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
      run(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...inputs, '-t', '0.5', ...codec, source]);
      const progress = [];
      const filename = await encodeForPremiere(source, ffmpeg, ffprobe, n => progress.push(n), () => {});
      const output = path.join(dir, filename);
      const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output]));
      const video = info.streams.find(s => s.codec_type === 'video');
      assert.equal(video.codec_name, 'h264');
      assert.equal(video.pix_fmt, 'yuv420p');
      assert.equal(video.width % 2, 0);
      assert.equal(video.height % 2, 0);
      assert.equal(info.streams.some(s => s.codec_type === 'audio'), audio);
      if (audio) assert.equal(info.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
      assert.ok(progress.length);
      run(ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-']);
      if (ext !== 'mp4') assert.equal(fs.existsSync(source), false);
    });
  }
  await t.test('failure preserves source and removes partial encoding', async () => {
    const source = path.join(dir, 'H264 fail.mp4');
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x90', '-t', '0.1', '-c:v', 'libx264', source]);
    const before = fs.readFileSync(source);
    await assert.rejects(encodeForPremiere(source, path.join(dir, 'missing.exe'), ffprobe, () => {}, () => {}));
    assert.deepEqual(fs.readFileSync(source), before);
    assert.equal(fs.readdirSync(dir).some(f => f.startsWith('.mdl-')), false);
  });
  await t.test('existing MP4 with same name is preserved', async () => {
    const source = path.join(dir, 'collision.mkv');
    const existing = path.join(dir, 'collision.mp4');
    fs.writeFileSync(existing, 'existing user file');
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x90', '-t', '0.1', '-c:v', 'ffv1', source]);
    const filename = await encodeForPremiere(source, ffmpeg, ffprobe, () => {}, () => {});
    assert.equal(filename, 'collision (H264 1).mp4');
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing user file');
  });
});
