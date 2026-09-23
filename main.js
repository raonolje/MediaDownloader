const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const { spawn, execFile } = require('child_process');
const fs    = require('fs');
const os    = require('os');
const https = require('https');
const http  = require('http');
const crypto = require('crypto');

let mainWindow;

// ─── yt-dlp 자동 업데이트 설정 ───────────────────────────────────────────
const YTDLP_REPO              = 'yt-dlp/yt-dlp';
const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 실행 중 6시간마다 재확인
const FAILURE_RECHECK_MS      = 10 * 60 * 1000;      // 다운로드 실패 시 재확인 최소 간격

// ─── 지원 플랫폼 ─────────────────────────────────────────────────────────
const PLATFORMS = {
  youtube:   { name: 'YouTube',   patterns: [/youtube\.com/, /youtu\.be/] },
  tiktok:    { name: 'TikTok',    patterns: [/tiktok\.com/] },
  twitter:   { name: 'X (Twitter)', patterns: [/twitter\.com/, /x\.com/] },
  instagram: { name: 'Instagram', patterns: [/instagram\.com/] },
};

function detectPlatform(url) {
  try {
    for (const [key, info] of Object.entries(PLATFORMS)) {
      if (info.patterns.some(p => p.test(url))) return key;
    }
  } catch(_) {}
  return 'unknown';
}

function isValidMediaUrl(url) {
  return Object.values(PLATFORMS).some(p => p.patterns.some(r => r.test(url)));
}

// ─── 경로 헬퍼 ───────────────────────────────────────────────────────────
function getAppDataVendorDir() {
  return path.join(app.getPath('userData'), 'vendor');
}

function getVendorExe(exe) {
  const appDataPath = path.join(getAppDataVendorDir(), exe);
  if (fs.existsSync(appDataPath)) return appDataPath;
  const bundlePaths = [
    path.join(process.resourcesPath, 'vendor', exe),
    path.join(__dirname, 'vendor', exe),
  ];
  for (const p of bundlePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getYtdlp() {
  applyStagedYtdlp();
  return getVendorExe('yt-dlp.exe') || 'yt-dlp';
}
function getFfmpegDir() {
  const p = getVendorExe('ffmpeg.exe') || getVendorExe('ffmpeg');
  return p ? path.dirname(p) : null;
}

function ensureAppDataVendorDir() {
  const dir = getAppDataVendorDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── 임시 파일 ───────────────────────────────────────────────────────────
function tmpFile(tag) {
  return path.join(os.tmpdir(), `mdl_${tag}_${Date.now()}.txt`);
}

// ─── yt-dlp 실행: 파일 저장 방식 (인코딩 완전 해결) ─────────────────────
function runToFile(exePath, args, outFile) {
  return new Promise((resolve, reject) => {
    const q    = (s) => (s.includes(' ') ? `"${s}"` : s);
    const qArgs = args.map(a => (a.includes(' ') && !a.startsWith('"') ? `"${a}"` : a));
    const cmd  = `chcp 65001 > nul 2>&1 && ${q(exePath)} ${qArgs.join(' ')} > "${outFile}" 2>&1`;
    const proc = spawn('cmd.exe', ['/c', cmd], {
      windowsHide: true,
      // 없으면 Node가 명령 안의 " 를 \" 로 바꿔 cmd.exe가 경로를 못 읽음 (출력 파일이 안 생김)
      windowsVerbatimArguments: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    proc.on('close', resolve);
    proc.on('error', reject);
  });
}

// ─── yt-dlp 실행: 스트림 방식 (진행률용) ────────────────────────────────
function runStream(exePath, args, onData) {
  return new Promise((resolve) => {
    const q    = (s) => (s.includes(' ') ? `"${s}"` : s);
    const qArgs = args.map(a => (a.includes(' ') && !a.startsWith('"') ? `"${a}"` : a));
    const cmd  = `chcp 65001 > nul 2>&1 && ${q(exePath)} ${qArgs.join(' ')}`;
    const proc = spawn('cmd.exe', ['/c', cmd], {
      windowsHide: true,
      windowsVerbatimArguments: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', resolve);
    proc.on('error', () => resolve(-1));
  });
}

function stripChcp(str) {
  return str.replace(/^Active code page:.*\r?\n?/gm, '').trim();
}

// ─── 윈도우 생성 ─────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860, height: 720, minWidth: 700, minHeight: 580,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Media Downloader',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#f4f6f9',
    show: false
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // 시작 시 확인은 렌더러가 준비된 뒤 요청 (auto-update-ytdlp), 이후엔 주기적으로 확인
  setInterval(() => autoUpdateYtdlp(), AUTO_UPDATE_INTERVAL_MS);
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── 기본 API ────────────────────────────────────────────────────────────
ipcMain.handle('get-downloads-folder', () => app.getPath('downloads'));

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'], title: '다운로드 폴더 선택',
    defaultPath: app.getPath('downloads')
  });
  return (!result.canceled && result.filePaths.length > 0) ? result.filePaths[0] : null;
});

ipcMain.handle('open-folder', async (_, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) shell.openPath(folderPath);
});

// ─── 플랫폼 감지 API ─────────────────────────────────────────────────────
ipcMain.handle('detect-platform', (_, url) => detectPlatform(url));
ipcMain.handle('is-valid-url', (_, url) => isValidMediaUrl(url));

// ─── 환경 체크 ────────────────────────────────────────────────────────────
ipcMain.handle('check-environment', async () => {
  const ytdlpPath  = getVendorExe('yt-dlp.exe')  || await findExec('yt-dlp');
  const ffmpegPath = getVendorExe('ffmpeg.exe')   || await findExec('ffmpeg');
  return {
    ytdlp:  !!ytdlpPath,  ytdlpPath:  ytdlpPath  || '',
    ffmpeg: !!ffmpegPath, ffmpegPath: ffmpegPath || ''
  };
});

// ─── 업데이트 체크 ────────────────────────────────────────────────────────
ipcMain.handle('check-updates', async () => {
  const result = { ytdlp: null, ffmpeg: null };
  try {
    result.ytdlp = { current: await getYtdlpVersion(), latest: null, needsUpdate: false };
  } catch(e) {}
  try {
    const latest = await fetchGitHubLatest(YTDLP_REPO);
    if (result.ytdlp && latest) {
      const latestClean  = latest.replace(/^v/i, '').trim();
      const currentClean = (result.ytdlp.current || '').replace(/^v/i, '').trim();
      result.ytdlp.latest      = latestClean;
      result.ytdlp.needsUpdate = currentClean !== '' && compareVersions(currentClean, latestClean) < 0;
    }
  } catch(e) {}
  try {
    const ffmpegExe = getVendorExe('ffmpeg.exe') || 'ffmpeg';
    const outFile   = tmpFile('ffver');
    await runToFile(ffmpegExe, ['-version'], outFile);
    const raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    const m = raw.match(/ffmpeg version ([\d]+\.[\d]+(?:\.[\d]+)?(?:-[\w.]+)?)/);
    const ffver = m ? m[1].replace(/-.*$/, '') : 'unknown';
    result.ffmpeg = { current: ffver, latest: null, needsUpdate: false };
  } catch(e) {}
  try {
    const latest = await fetchGitHubLatest('GyanD/codexffmpeg');
    if (result.ffmpeg && latest) {
      const latestVer  = latest.replace(/-.*$/, '').trim();
      const currentVer = (result.ffmpeg.current || '').replace(/-.*$/, '').trim();
      result.ffmpeg.latest      = latestVer;
      result.ffmpeg.needsUpdate = currentVer !== 'unknown' && currentVer !== latestVer;
    }
  } catch(e) {}
  return result;
});

// ─── yt-dlp 버전 조회 ─────────────────────────────────────────────────────
async function getYtdlpVersion() {
  const outFile = tmpFile('ytver');
  try {
    await runToFile(getYtdlp(), ['--version'], outFile);
    const raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    // chcp 출력, 공백, 개행 모두 제거 후 순수 버전 문자열만 추출
    return raw
      .replace(/Active code page:\s*\d+\s*/gi, '')
      .replace(/\r/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[\d]{4}\./.test(l) || /^\d+\.\d+/.test(l))[0] || '';
  } finally {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch(_) {}
  }
}

// 2026.08.19 / 2026.08.19.1 형식 비교 (a < b 이면 음수)
function compareVersions(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ─── yt-dlp 설치/교체 ────────────────────────────────────────────────────
// 실행 중인 exe는 덮어쓸 수 없으므로 yt-dlp.exe.new 로 받아 두고, yt-dlp를 실행하기 직전에 교체
function getStagedYtdlpPath() {
  return path.join(getAppDataVendorDir(), 'yt-dlp.exe.new');
}

function applyStagedYtdlp() {
  const staged = getStagedYtdlpPath();
  if (!fs.existsSync(staged)) return false;
  try {
    fs.renameSync(staged, path.join(getAppDataVendorDir(), 'yt-dlp.exe'));
    return true;
  } catch(_) {
    return false;  // 아직 실행 중이라 잠겨 있음 → 다음 실행 때 다시 시도
  }
}

// GitHub 릴리스의 yt-dlp.exe를 받아 SHA-256 검증 후 설치
async function installYtdlp(tag, onProgress) {
  const dir     = ensureAppDataVendorDir();
  const base    = `https://github.com/${YTDLP_REPO}/releases/download/${tag}`;
  const tmpPath = path.join(dir, 'yt-dlp.exe.download');

  const sums = await fetchText(`${base}/SHA2-256SUMS`);
  const m    = sums.match(/^([a-f0-9]{64})\s+\*?yt-dlp\.exe\r?$/mi);
  if (!m) throw new Error('체크섬 정보를 찾을 수 없습니다');

  try {
    await downloadFile(`${base}/yt-dlp.exe`, tmpPath, onProgress);
    if (await sha256File(tmpPath) !== m[1].toLowerCase()) throw new Error('체크섬이 일치하지 않습니다');
    fs.renameSync(tmpPath, getStagedYtdlpPath());
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch(_) {}
  }
  return { applied: applyStagedYtdlp() };
}

// ─── yt-dlp 자동 업데이트 ────────────────────────────────────────────────
let ytdlpUpdateJob = null;  // 진행 중인 확인 작업 (중복 실행 방지)
let lastYtdlpCheck = 0;     // 마지막으로 최신 버전 확인에 성공한 시각

// 반환: { updated, from, to } | { updated: false, error } | { updated: false, skipped }
function autoUpdateYtdlp({ minGapMs = 0 } = {}) {
  if (ytdlpUpdateJob) return ytdlpUpdateJob;
  if (Date.now() - lastYtdlpCheck < minGapMs) return Promise.resolve({ updated: false, skipped: true });

  ytdlpUpdateJob = (async () => {
    // 이전에 받아 둔 업데이트가 아직 교체 대기 중이면 새로 받지 않음
    if (fs.existsSync(getStagedYtdlpPath()) && !applyStagedYtdlp()) return { updated: false, skipped: true };

    const latest = await fetchGitHubLatest(YTDLP_REPO);
    if (!latest) return { updated: false, error: '최신 버전 정보를 가져오지 못했습니다' };
    lastYtdlpCheck = Date.now();

    const current = await getYtdlpVersion();
    if (current && compareVersions(current, latest) >= 0) return { updated: false, current };

    let lastPct = -1;
    send('ytdlp-auto-update', { state: 'downloading', from: current, to: latest, pct: 0 });
    try {
      await installYtdlp(latest, (pct) => {
        if (pct === lastPct) return;
        lastPct = pct;
        send('ytdlp-auto-update', { state: 'downloading', from: current, to: latest, pct });
      });
    } catch(e) {
      send('ytdlp-auto-update', { state: 'error', to: latest, message: e.message });
      return { updated: false, error: e.message };
    }
    send('ytdlp-auto-update', { state: 'done', from: current, to: latest });
    return { updated: true, from: current, to: latest };
  })()
    .catch(e => ({ updated: false, error: e.message }))
    .finally(() => { ytdlpUpdateJob = null; });

  return ytdlpUpdateJob;
}

ipcMain.handle('auto-update-ytdlp', () => autoUpdateYtdlp());

// ─── yt-dlp 수동 설치 (yt-dlp가 없을 때 '자동 설치' 버튼) ─────────────────
ipcMain.handle('update-ytdlp', async () => {
  try {
    send('update-progress', { tool: 'ytdlp', msg: 'yt-dlp 최신 버전 다운로드 중...', pct: 0 });
    const tag = await fetchGitHubLatest(YTDLP_REPO);
    if (!tag) throw new Error('최신 버전 정보를 가져오지 못했습니다');
    await installYtdlp(tag, (pct) =>
      send('update-progress', { tool: 'ytdlp', msg: `다운로드 중... ${pct}%`, pct })
    );
    send('update-progress', { tool: 'ytdlp', msg: 'yt-dlp 업데이트 완료!', pct: 100, done: true });
    return { success: true };
  } catch(e) {
    send('update-progress', { tool: 'ytdlp', msg: `오류: ${e.message}`, done: true, error: true });
    return { success: false, message: e.message };
  }
});

// ─── yt-dlp 공통 옵션 ────────────────────────────────────────────────────
// --encoding utf-8 : 없으면 PYTHONIOENCODING과 무관하게 CP949로 출력돼 한글 제목이 깨짐
// --js-runtimes    : JS 런타임이 없으면 YouTube 일부 클라이언트/포맷만 쓸 수 있음.
//                    vendor 폴더의 deno.exe, 없으면 설치된 Node.js(v22 이상)를 사용
let ytdlpCommonArgsJob = null;
function getYtdlpCommonArgs() {
  if (!ytdlpCommonArgsJob) {
    ytdlpCommonArgsJob = (async () => {
      const args = ['--encoding', 'utf-8'];
      const deno = getVendorExe('deno.exe');
      const node = deno ? null : await findExec('node');
      if (deno) args.push('--js-runtimes', `deno:${deno}`);
      else if (node && await getNodeMajorVersion(node) >= 22) args.push('--js-runtimes', `node:${node}`);
      return args;
    })();
  }
  return ytdlpCommonArgsJob;
}

function getNodeMajorVersion(nodePath) {
  return new Promise((resolve) => {
    execFile(nodePath, ['--version'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      const m = !err && /^v(\d+)/.exec(String(stdout).trim());
      resolve(m ? parseInt(m[1], 10) : 0);
    });
  });
}

// ─── ffmpeg 업데이트 ──────────────────────────────────────────────────────
ipcMain.handle('update-ffmpeg', async () => {
  try {
    send('update-progress', { tool: 'ffmpeg', msg: 'ffmpeg 다운로드 중...', pct: 0 });
    const dir     = ensureAppDataVendorDir();
    const zipPath = path.join(os.tmpdir(), `ffmpeg_upd_${Date.now()}.zip`);
    const url     = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
    await downloadFile(url, zipPath, (pct) =>
      send('update-progress', { tool: 'ffmpeg', msg: `다운로드 중... ${pct}%`, pct })
    );
    send('update-progress', { tool: 'ffmpeg', msg: '압축 해제 중...', pct: 100 });
    const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem;
$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}');
$entries = $zip.Entries | Where-Object { $_.Name -eq 'ffmpeg.exe' -or $_.Name -eq 'ffprobe.exe' };
foreach ($e in $entries) {
  $dest = '${dir.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}\\' + $e.Name;
  $s = $e.Open(); $f = [System.IO.File]::Create($dest);
  $s.CopyTo($f); $f.Close(); $s.Close();
}
$zip.Dispose();
`;
    await new Promise((res, rej) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
      proc.on('close', (code) => code === 0 ? res() : rej(new Error(`PowerShell 오류: ${code}`)));
      proc.on('error', rej);
    });
    try { fs.unlinkSync(zipPath); } catch(_) {}
    send('update-progress', { tool: 'ffmpeg', msg: 'ffmpeg 업데이트 완료!', pct: 100, done: true });
    return { success: true };
  } catch(e) {
    send('update-progress', { tool: 'ffmpeg', msg: `오류: ${e.message}`, done: true, error: true });
    return { success: false, message: e.message };
  }
});

// ─── 미디어 정보 조회 (파일 저장 방식) ───────────────────────────────────
ipcMain.handle('get-media-info', async (_, url) => {
  const ytdlp   = getYtdlp();
  const outFile = tmpFile('info');
  try {
    await runToFile(ytdlp, [...await getYtdlpCommonArgs(), '--dump-json', '--no-playlist', url], outFile);
    if (!fs.existsSync(outFile)) return { success: false, message: '출력 없음' };
    const raw  = fs.readFileSync(outFile, 'utf8');
    fs.unlinkSync(outFile);
    const cleaned = stripChcp(raw);
    // 여러 줄 JSON 중 첫 번째 유효한 JSON 파싱
    const lines = cleaned.split('\n');
    let info = null;
    for (const line of lines) {
      try { info = JSON.parse(line.trim()); break; } catch(_) {}
    }
    if (!info) return { success: false, message: 'JSON 파싱 실패' };
    const platform = detectPlatform(url);
    return {
      success:   true,
      platform,
      title:     info.title     || '제목 없음',
      duration:  fmtDuration(info.duration || 0),
      thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails[0] && info.thumbnails[0].url) || '',
      uploader:  info.uploader  || info.channel || info.creator || '',
      viewCount: info.view_count ? info.view_count.toLocaleString() : '',
      likeCount: info.like_count ? info.like_count.toLocaleString() : '',
    };
  } catch(e) {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch(_) {}
    return { success: false, message: e.message };
  }
});

// ─── 파일명 사전 조회 ────────────────────────────────────────────────────
async function getExpectedFilename(url, outputDir, mode) {
  const ytdlp   = getYtdlp();
  const ext     = mode === 'mp3' ? 'mp3' : 'mp4';
  const tmpl    = path.join(outputDir, `%(title)s.${ext}`);
  const outFile = tmpFile('fname');
  try {
    await runToFile(ytdlp, [...await getYtdlpCommonArgs(), '--print', 'filename', '--no-playlist', '-o', tmpl, url], outFile);
    if (!fs.existsSync(outFile)) return '';
    const raw     = fs.readFileSync(outFile, 'utf8');
    fs.unlinkSync(outFile);
    const cleaned = stripChcp(raw);
    return cleaned ? path.basename(cleaned.split('\n')[0].trim()) : '';
  } catch(e) {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch(_) {}
    return '';
  }
}

// ─── 다운로드 실행 ────────────────────────────────────────────────────────
ipcMain.handle('start-download', (_, opts) => startDownload(opts));

async function startDownload(opts, isRetry = false) {
  const { id, url, outputDir, mode } = opts;
  const startedAt = Date.now();
  const ytdlp     = getYtdlp();
  const ffmpegDir = getFfmpegDir();
  const platform  = detectPlatform(url);

  // 파일명 사전 조회
  const expectedFilename = await getExpectedFilename(url, outputDir, mode);
  if (expectedFilename) {
    send('download-progress', { id, percent: 0, filename: expectedFilename });
  }

  const outTemplate = path.join(outputDir, '%(title)s.%(ext)s');
  let args = ['--newline', '--no-playlist'];

  if (mode === 'mp3') {
    // MP3 추출: YouTube만 후처리 옵션 사용, 나머지는 기본 추출만
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    if (ffmpegDir && platform === 'youtube') {
      args.push('--add-metadata');
    }
  } else {
    // 플랫폼별 최적 포맷 설정
    if (platform === 'youtube') {
      args.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
    } else if (platform === 'tiktok') {
      // TikTok: 단순 best 포맷 (후처리 없이 안정적 다운로드)
      args.push('-f', 'best[ext=mp4]/best', '--no-check-certificate');
    } else if (platform === 'twitter') {
      args.push('-f', 'best[ext=mp4]/best');
    } else if (platform === 'instagram') {
      args.push('-f', 'best[ext=mp4]/best');
    } else {
      args.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
    }
  }

  if (ffmpegDir) args.unshift('--ffmpeg-location', ffmpegDir);
  args.unshift(...await getYtdlpCommonArgs());
  args.push('-o', outTemplate, url);

  let lastFilename = expectedFilename || '';

  const code = await runStream(ytdlp, args, (text) => {
    if (/^Active code page:/i.test(text.trim())) return;
    const m = text.match(/(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\s*[\w.]+)\s+at\s+([\d.]+\s*[\w/]+)/);
    if (m) {
      send('download-progress', {
        id, percent: parseFloat(m[1]),
        size: m[2].trim(), speed: m[3].trim(),
        filename: lastFilename
      });
    }
    if (/\[Merger\]/.test(text)) {
      send('download-progress', { id, percent: 99, filename: lastFilename, merging: true });
    }
    send('download-log', { id, text });
  });

  // 종료 코드가 0이 아니더라도 실제 파일이 저장됐으면 성공으로 처리
  // (TikTok/Instagram 등은 후처리 경고로 코드 1 반환하지만 파일은 정상 저장됨)
  if (code !== 0) {
    // 완성된 미디어 파일만 인정 (.part, 병합 전 조각 파일 xxx.f401.mp4 등은 제외)
    const mediaExts    = ['.mp4', '.mp3', '.webm', '.mkv', '.m4a', '.mov'];
    const isFinalMedia = (f) => mediaExts.includes(path.extname(f).toLowerCase()) && !/\.f[\w-]+\.\w+$/.test(f);
    // 1단계: 파일명이 있으면 직접 확인
    if (lastFilename) {
      const expectedPath = path.join(outputDir, lastFilename);
      if (fs.existsSync(expectedPath)) {
        return { success: true, filename: lastFilename };
      }
      // 확장자 변형 가능성 고려 (mp4, webm, mkv 등)
      const base = path.basename(lastFilename, path.extname(lastFilename));
      const files = fs.readdirSync(outputDir).filter(f => isFinalMedia(f) && path.basename(f, path.extname(f)) === base);
      if (files.length > 0) {
        return { success: true, filename: files[0] };
      }
    }
    // 2단계: 파일명이 없어도 이번 다운로드 시작 이후 저장폴더에 생성된 미디어 파일 탐색
    try {
      const recentFiles = fs.readdirSync(outputDir)
        .filter(isFinalMedia)
        .map(f => {
          const st = fs.statSync(path.join(outputDir, f));
          return { name: f, time: Math.max(st.mtimeMs, st.birthtimeMs) };
        })
        .filter(f => f.time >= startedAt)
        .sort((a, b) => b.time - a.time);
      if (recentFiles.length > 0) {
        return { success: true, filename: recentFiles[0].name };
      }
    } catch(_) {}
    // yt-dlp가 사이트 변경을 못 따라가서 실패하는 경우가 많으므로, 새 버전이 있으면 받아서 한 번 재시도
    if (!isRetry && await updateYtdlpAfterFailure(id)) return startDownload(opts, true);
    return { success: false, message: `오류가 발생했습니다 (코드: ${code}). 다운로드 폴더를 확인해 보세요.` };
  }
  return { success: true, filename: lastFilename };
}

async function updateYtdlpAfterFailure(id) {
  const log = (text) => send('download-log', { id, text: `[자동 업데이트] ${text}\n` });
  log('다운로드 실패 — yt-dlp 새 버전이 있는지 확인합니다...');
  const r = await autoUpdateYtdlp({ minGapMs: FAILURE_RECHECK_MS });
  if (r.updated) {
    log(`yt-dlp ${r.from || '(없음)'} → ${r.to} 업데이트 완료. 다시 다운로드합니다.`);
    return true;
  }
  log(r.error ? `확인 실패: ${r.error}` : 'yt-dlp가 이미 최신 버전입니다.');
  return false;
}

// ─── 유틸 ────────────────────────────────────────────────────────────────
function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function fetchGitHubLatest(repo) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: { 'User-Agent': 'MediaDownloader/1.0' },
      timeout: 8000
    };
    const req = https.get(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data).tag_name || null); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// 리다이렉트를 따라가 200 응답 스트림을 반환
function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'MediaDownloader/1.0' }, timeout: 30000 }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpGet(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Download timeout')));
  });
}

async function fetchText(url) {
  const res = await httpGet(url);
  res.setEncoding('utf8');
  let data = '';
  for await (const chunk of res) data += chunk;
  return data;
}

async function downloadFile(url, dest, onProgress) {
  const res    = await httpGet(url);
  const total  = parseInt(res.headers['content-length'] || '0', 10);
  let received = 0;
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    res.on('data', (chunk) => {
      received += chunk.length;
      if (total > 0 && onProgress) onProgress(Math.round(received / total * 100));
    });
    res.on('error', (e) => { file.destroy(); reject(e); });
    res.on('close', () => {
      if (!res.complete) { file.destroy(); reject(new Error('다운로드 연결이 끊어졌습니다')); }
    });
    file.on('error', reject);
    file.on('finish', resolve);  // 디스크에 다 쓴 뒤에 완료 처리
    res.pipe(file);
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', d => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function findExec(name) {
  return new Promise((resolve) => {
    const proc = spawn('cmd.exe', ['/c', `where ${name}`], { windowsHide: true });
    let out = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => resolve(out.trim() ? out.trim().split('\n')[0].trim() : null));
    proc.on('error', () => resolve(null));
  });
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
