// ─── 상태 ─────────────────────────────────────────────────────────────────
let currentMode    = 'video';
let selectedFolder = '';
let isDownloading  = false;
let logVisible     = true;
let envState       = { ytdlp: false, ffmpeg: false };
let urlRowCount    = 0;
let infoTimers     = {};
let pendingUpdates = {};

// 플랫폼 정보
const PLATFORM_INFO = {
  youtube:   { label: '🎬 YouTube',    cls: 'youtube' },
  tiktok:    { label: '🎵 TikTok',     cls: 'tiktok' },
  twitter:   { label: '🐦 X (Twitter)', cls: 'twitter' },
  instagram: { label: '📸 Instagram',  cls: 'instagram' },
  unknown:   { label: '🌐 Unknown',    cls: 'unknown' },
};

// ─── 초기화 ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const defaultFolder = await window.electronAPI.getDownloadsFolder();
  selectedFolder = defaultFolder;
  document.getElementById('folderInput').value = defaultFolder;

  addUrlRow();
  await checkEnvironment();
  checkUpdatesInBackground();

  window.electronAPI.onDownloadProgress((data) => {
    updateInlineProgress(data.id, data);
    if (data.filename) {
      const el = document.getElementById(`upLabel_${data.id}`);
      if (el) el.textContent = data.filename;
    }
    if (data.merging) {
      const el = document.getElementById(`upLabel_${data.id}`);
      if (el && !el.textContent.startsWith('병합')) el.textContent = '병합 중... ' + el.textContent;
      const pct = document.getElementById(`upPct_${data.id}`);
      if (pct) pct.textContent = '99%';
    }
  });

  window.electronAPI.onDownloadLog((data) => {
    appendLog(data.text);
    if (data.id !== undefined) parseLogForProgress(data.id, data.text);
  });

  window.electronAPI.onUpdateProgress((data) => {
    handleUpdateProgress(data);
  });
});

// ─── 환경 체크 ────────────────────────────────────────────────────────────
async function checkEnvironment() {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  text.textContent = '환경 확인 중...';
  dot.className = 'status-dot';

  envState = await window.electronAPI.checkEnvironment();

  if (!envState.ytdlp) {
    dot.className = 'status-dot warn';
    text.textContent = 'yt-dlp 미설치';
    document.getElementById('bannerDesc').textContent = 'yt-dlp가 필요합니다.';
    document.getElementById('envBanner').style.display = 'block';
  } else {
    dot.className = 'status-dot ok';
    text.textContent = envState.ffmpeg ? '모든 도구 준비됨' : '준비됨 (ffmpeg 없음)';
    document.getElementById('envBanner').style.display = 'none';
  }
  updateDownloadButton();
}

// ─── 업데이트 체크 ────────────────────────────────────────────────────────
async function checkUpdatesInBackground() {
  if (!envState.ytdlp) return;
  try {
    const result = await window.electronAPI.checkUpdates();
    pendingUpdates = {};
    const msgs = [];
    if (result.ytdlp && result.ytdlp.needsUpdate) {
      pendingUpdates.ytdlp = true;
      msgs.push(`yt-dlp ${result.ytdlp.current} → ${result.ytdlp.latest}`);
    }
    if (result.ffmpeg && result.ffmpeg.needsUpdate) {
      pendingUpdates.ffmpeg = true;
      msgs.push(`ffmpeg ${result.ffmpeg.current} → ${result.ffmpeg.latest}`);
    }
    if (msgs.length > 0) {
      document.getElementById('updateBannerTitle').textContent = '업데이트 가능';
      document.getElementById('updateBannerDesc').textContent  = msgs.join(' / ');
      document.getElementById('updateBanner').style.display    = 'block';
    }
  } catch(e) {}
}

function closeUpdateBanner() {
  document.getElementById('updateBanner').style.display = 'none';
}

async function doUpdate() {
  const modal  = document.getElementById('updateModal');
  const status = document.getElementById('updateStatus');
  const log    = document.getElementById('updateLog');
  const btn    = document.getElementById('btnUpdateClose');
  const wrap   = document.getElementById('updateProgressWrap');
  const fill   = document.getElementById('updateProgressFill');
  const pct    = document.getElementById('updateProgressPct');

  modal.style.display = 'flex';
  log.textContent = '';
  btn.disabled = true;
  wrap.style.display = 'flex';
  fill.style.width = '0%';
  pct.textContent  = '0%';

  if (pendingUpdates.ytdlp) {
    status.textContent = 'yt-dlp 업데이트 중...';
    await window.electronAPI.updateYtdlp();
  }
  if (pendingUpdates.ffmpeg) {
    status.textContent = 'ffmpeg 업데이트 중...';
    await window.electronAPI.updateFfmpeg();
  }

  status.textContent = '업데이트 완료!';
  btn.disabled = false;
  closeUpdateBanner();
}

function handleUpdateProgress(data) {
  const log  = document.getElementById('updateLog');
  const fill = document.getElementById('updateProgressFill');
  const pct  = document.getElementById('updateProgressPct');
  const stat = document.getElementById('updateStatus');
  if (data.msg)  { log.textContent += data.msg + '\n'; log.scrollTop = log.scrollHeight; if (stat) stat.textContent = data.msg; }
  if (data.pct !== undefined) { fill.style.width = `${data.pct}%`; pct.textContent = `${data.pct}%`; }
}

function closeUpdateModal() {
  document.getElementById('updateModal').style.display = 'none';
}

// ─── 도구 설치 ────────────────────────────────────────────────────────────
async function installMissingTools() {
  const modal  = document.getElementById('installModal');
  const log    = document.getElementById('installLog');
  const status = document.getElementById('installStatus');
  const btn    = document.getElementById('btnModalClose');
  modal.style.display = 'flex';
  log.textContent = '';
  btn.disabled = true;
  if (!envState.ytdlp) {
    status.textContent = 'yt-dlp 설치 중...';
    const r = await window.electronAPI.updateYtdlp();
    log.textContent += r.success ? '\n✅ yt-dlp 설치 완료!\n' : `\n❌ 실패: ${r.message}\n`;
    if (r.success) envState.ytdlp = true;
  }
  status.textContent = '완료!';
  btn.disabled = false;
  await checkEnvironment();
}
function closeInstallModal() {
  document.getElementById('installModal').style.display = 'none';
}

// ─── URL 행 관리 ──────────────────────────────────────────────────────────
function addUrlRow() {
  const id   = ++urlRowCount;
  const list = document.getElementById('urlList');

  const row = document.createElement('div');
  row.className = 'url-row';
  row.id = `urlRow_${id}`;
  row.innerHTML = `
    <div class="url-input-group">
      <input
        type="text"
        id="urlInput_${id}"
        class="url-input"
        placeholder="YouTube, TikTok, X, Instagram URL을 붙여넣으세요"
        oninput="onUrlInput(${id})"
        onpaste="onUrlPaste(event,${id})"
      >
      <button class="btn-paste" onclick="pasteUrl(${id})" title="클립보드 붙여넣기">📋</button>
      ${urlRowCount > 1 ? `<button class="btn-remove-url" onclick="removeUrlRow(${id})" title="삭제">✕</button>` : ''}
    </div>
    <div id="urlPlatform_${id}" style="display:none;"></div>
    <div id="urlPreview_${id}"  style="display:none;"></div>
    <div id="urlLoading_${id}"  class="url-loading" style="display:none;">
      <div class="spinner-small"></div><span>미디어 정보 불러오는 중...</span>
    </div>
    <div id="urlProgress_${id}" style="display:none;"></div>
  `;
  list.appendChild(row);
  document.getElementById(`urlInput_${id}`).focus();
  updateDownloadButton();
}

function removeUrlRow(id) {
  const row = document.getElementById(`urlRow_${id}`);
  if (row) row.remove();
  if (infoTimers[id]) { clearTimeout(infoTimers[id]); delete infoTimers[id]; }
  updateDownloadButton();
}

function getUrlRows() {
  return Array.from(document.querySelectorAll('.url-row'))
    .map(r => {
      const inp = r.querySelector('.url-input');
      return inp ? { id: r.id.replace('urlRow_',''), url: inp.value.trim() } : null;
    })
    .filter(item => item && isValidUrl(item.url));
}

// ─── URL 유효성 검사 (클라이언트 측) ─────────────────────────────────────
function isValidUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|twitter\.com|x\.com|instagram\.com)\/.+/.test(url);
}

function detectPlatformLocal(url) {
  if (/youtube\.com|youtu\.be/.test(url))   return 'youtube';
  if (/tiktok\.com/.test(url))              return 'tiktok';
  if (/twitter\.com|x\.com/.test(url))      return 'twitter';
  if (/instagram\.com/.test(url))           return 'instagram';
  return 'unknown';
}

// ─── URL 입력 처리 ────────────────────────────────────────────────────────
function onUrlInput(id) {
  updateDownloadButton();
  if (infoTimers[id]) clearTimeout(infoTimers[id]);
  const url = document.getElementById(`urlInput_${id}`).value.trim();
  const inp = document.getElementById(`urlInput_${id}`);

  if (isValidUrl(url)) {
    const platform = detectPlatformLocal(url);
    inp.className = `url-input has-url platform-${platform}`;
    showPlatformBadge(id, platform);
    infoTimers[id] = setTimeout(() => fetchMediaInfo(id, url), 800);
  } else {
    inp.className = 'url-input';
    hidePlatformBadge(id);
    hidePreview(id);
  }
}

function onUrlPaste(event, id) {
  setTimeout(() => {
    const url = document.getElementById(`urlInput_${id}`).value.trim();
    if (isValidUrl(url)) {
      const platform = detectPlatformLocal(url);
      document.getElementById(`urlInput_${id}`).className = `url-input has-url platform-${platform}`;
      showPlatformBadge(id, platform);
      fetchMediaInfo(id, url);
    }
  }, 80);
}

async function pasteUrl(id) {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById(`urlInput_${id}`).value = text;
    onUrlInput(id);
  } catch(e) {
    document.getElementById(`urlInput_${id}`).focus();
  }
}

// ─── 플랫폼 배지 ──────────────────────────────────────────────────────────
function showPlatformBadge(id, platform) {
  const el   = document.getElementById(`urlPlatform_${id}`);
  const info = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
  el.innerHTML = `<span class="platform-badge ${info.cls}">${info.label}</span>`;
  el.style.display = 'block';
}
function hidePlatformBadge(id) {
  const el = document.getElementById(`urlPlatform_${id}`);
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// ─── 미디어 정보 미리보기 ─────────────────────────────────────────────────
async function fetchMediaInfo(id, url) {
  if (!envState.ytdlp) return;
  document.getElementById(`urlLoading_${id}`).style.display = 'flex';
  hidePreview(id);
  try {
    const info = await window.electronAPI.getMediaInfo(url);
    document.getElementById(`urlLoading_${id}`).style.display = 'none';
    if (info.success) renderPreview(id, info);
  } catch(e) {
    document.getElementById(`urlLoading_${id}`).style.display = 'none';
  }
}

function renderPreview(id, info) {
  const box = document.getElementById(`urlPreview_${id}`);
  box.innerHTML = `
    <div class="video-preview">
      <div class="preview-thumbnail">
        ${info.thumbnail ? `<img src="${info.thumbnail}" alt="썸네일">` : '<div style="width:100%;height:100%;background:#e0e3e8;display:flex;align-items:center;justify-content:center;font-size:20px;">🎬</div>'}
        ${info.duration !== '0:00' ? `<span class="preview-duration">${info.duration}</span>` : ''}
      </div>
      <div class="preview-info">
        <div class="preview-title">${escHtml(info.title)}</div>
        <div class="preview-meta">
          ${info.uploader ? `<span>${escHtml(info.uploader)}</span>` : ''}
          ${info.viewCount ? `<span class="meta-sep">•</span><span>조회수 ${info.viewCount}</span>` : ''}
        </div>
      </div>
    </div>
  `;
  box.style.display = 'block';
}

function hidePreview(id) {
  const box = document.getElementById(`urlPreview_${id}`);
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  const loading = document.getElementById(`urlLoading_${id}`);
  if (loading) loading.style.display = 'none';
}

// ─── 모드 선택 ────────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  document.getElementById('modeVideo').classList.toggle('active', mode === 'video');
  document.getElementById('modeAudio').classList.toggle('active', mode === 'mp3');
}

// ─── 폴더 선택 ────────────────────────────────────────────────────────────
async function selectFolder() {
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedFolder = folder;
    document.getElementById('folderInput').value = folder;
    updateDownloadButton();
  }
}

// ─── 다운로드 버튼 상태 ───────────────────────────────────────────────────
function updateDownloadButton() {
  const items = getUrlRows();
  const btn   = document.getElementById('btnDownload');
  btn.disabled = !(items.length > 0 && selectedFolder && !isDownloading && envState.ytdlp);
}

// ─── 다운로드 시작 ────────────────────────────────────────────────────────
async function startAllDownloads() {
  const items = getUrlRows();
  if (!items.length || isDownloading) return;

  isDownloading = true;
  updateDownloadButton();

  const btn = document.getElementById('btnDownload');
  btn.classList.add('downloading');
  document.getElementById('btnDownloadText').textContent = '다운로드 중...';

  document.getElementById('logSection').style.display = 'block';
  document.getElementById('logContent').textContent = '';

  for (const item of items) {
    const { id, url } = item;
    hidePreview(id);
    initInlineProgress(id);

    const result = await window.electronAPI.startDownload({
      id, url, outputDir: selectedFolder, mode: currentMode
    });

    finishInlineProgress(id, result.success, result.filename || result.message || '');
  }

  isDownloading = false;
  btn.classList.remove('downloading');
  document.getElementById('btnDownloadText').textContent = '다운로드';
  updateDownloadButton();
}

// ─── 인라인 진행바 ────────────────────────────────────────────────────────
function initInlineProgress(id) {
  const box = document.getElementById(`urlProgress_${id}`);
  box.style.display = 'block';
  box.innerHTML = `
    <div class="url-progress" id="upBox_${id}">
      <div class="url-progress-header">
        <span class="url-progress-label" id="upLabel_${id}">준비 중...</span>
        <span class="url-progress-pct"   id="upPct_${id}">0%</span>
      </div>
      <div class="url-progress-track">
        <div class="url-progress-fill" id="upFill_${id}" style="width:0%"></div>
      </div>
      <div class="url-progress-meta">
        <span id="upSize_${id}"></span>
        <span id="upSpeed_${id}"></span>
      </div>
    </div>
  `;
}

function updateInlineProgress(id, data) {
  const pct   = Math.min(100, Math.round(data.percent || 0));
  const fill  = document.getElementById(`upFill_${id}`);
  const pctEl = document.getElementById(`upPct_${id}`);
  if (fill)  fill.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (data.speed) { const el = document.getElementById(`upSpeed_${id}`); if (el) el.textContent = data.speed; }
  if (data.size)  { const el = document.getElementById(`upSize_${id}`);  if (el) el.textContent = data.size; }
}

function parseLogForProgress(id, text) {
  const m = text.match(/(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+([\d.]+\s*[\w/]+)/);
  if (m) updateInlineProgress(id, { percent: parseFloat(m[1]), size: m[2].trim(), speed: m[3].trim() });
}

function finishInlineProgress(id, success, filename) {
  const box   = document.getElementById(`upBox_${id}`);
  const fill  = document.getElementById(`upFill_${id}`);
  const pctEl = document.getElementById(`upPct_${id}`);
  const label = document.getElementById(`upLabel_${id}`);

  if (success) {
    if (box)   box.classList.add('state-done');
    if (fill)  { fill.style.width = '100%'; fill.classList.add('done'); }
    if (pctEl) { pctEl.textContent = '완료 ✅'; pctEl.className = 'url-progress-pct done'; }
    if (label && filename) label.textContent = filename;
  } else {
    if (box)   box.classList.add('state-error');
    if (fill)  fill.classList.add('error');
    if (pctEl) { pctEl.textContent = '실패'; pctEl.className = 'url-progress-pct error'; }
    if (label) label.textContent = `오류: ${filename}`;
  }
}

// ─── 로그 ────────────────────────────────────────────────────────────────
function appendLog(text) {
  const el = document.getElementById('logContent');
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}
function toggleLog() {
  logVisible = !logVisible;
  document.getElementById('logContent').style.display = logVisible ? 'block' : 'none';
  document.querySelector('.btn-log-toggle').textContent = logVisible ? '접기 ▲' : '펼치기 ▼';
}

// ─── 유틸 ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
