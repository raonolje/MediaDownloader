const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 폴더
  getDownloadsFolder: ()       => ipcRenderer.invoke('get-downloads-folder'),
  selectFolder:       ()       => ipcRenderer.invoke('select-folder'),
  openFolder:         (p)      => ipcRenderer.invoke('open-folder', p),

  // 환경
  checkEnvironment:   ()       => ipcRenderer.invoke('check-environment'),

  // 플랫폼 감지
  detectPlatform:     (url)    => ipcRenderer.invoke('detect-platform', url),
  isValidUrl:         (url)    => ipcRenderer.invoke('is-valid-url', url),

  // 업데이트
  checkUpdates:       ()       => ipcRenderer.invoke('check-updates'),
  updateYtdlp:        ()       => ipcRenderer.invoke('update-ytdlp'),
  updateFfmpeg:       ()       => ipcRenderer.invoke('update-ffmpeg'),

  // 미디어
  getMediaInfo:       (url)    => ipcRenderer.invoke('get-media-info', url),
  startDownload:      (opts)   => ipcRenderer.invoke('start-download', opts),

  // 이벤트
  onDownloadProgress: (cb)     => ipcRenderer.on('download-progress', (_, d) => cb(d)),
  onDownloadLog:      (cb)     => ipcRenderer.on('download-log',      (_, d) => cb(d)),
  onUpdateProgress:   (cb)     => ipcRenderer.on('update-progress',   (_, d) => cb(d)),

  removeAllListeners: (ch)     => ipcRenderer.removeAllListeners(ch)
});
