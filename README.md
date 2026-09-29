# Media Downloader

YouTube · TikTok · X · Instagram 영상/음원 다운로더 (Electron + yt-dlp + ffmpeg).

## 폴더 구성

```
03_Media_Downloader/
├── main.js        메인 프로세스: yt-dlp 실행, 다운로드, yt-dlp 자동 업데이트
├── preload.js     렌더러에 노출하는 IPC API (window.electronAPI)
├── renderer.js    화면 로직
├── index.html / styles.css
├── assets/        icon.ico (앱 아이콘), icon.svg (원본 — 수정 후 README 하단 방법으로 .ico 재생성)
├── vendor/        ffmpeg.exe, ffprobe.exe, yt-dlp.exe (git 제외, 아래 참고)
└── package.json   electron-builder 설정 포함
```

## 개발 실행 / 빌드

```bash
npm install
npm start          # 개발 실행 (vendor/ 의 도구를 사용)
npm run build      # dist/ 에 포터블 exe + win-unpacked 생성
```

`E:\MediaDownloader_Portable` 은 `dist/win-unpacked` 와 같은 구성이다.
코드만 바꿨다면 `npm run build` 후 `dist/win-unpacked/resources/app.asar` 하나만
`E:\MediaDownloader_Portable\resources\` 에 덮어써도 된다 (앱을 끈 상태에서, 기존 파일은 백업).

## vendor/ 도구

용량이 커서 git에는 넣지 않는다. 없으면 아래에서 받아 `vendor/` 에 둔다.

| 파일 | 출처 |
|------|------|
| `yt-dlp.exe` | https://github.com/yt-dlp/yt-dlp/releases/latest |
| `ffmpeg.exe`, `ffprobe.exe` | https://www.gyan.dev/ffmpeg/builds/ (release essentials) |

yt-dlp는 앱이 실행될 때 자동으로 최신 버전을 받아 `%APPDATA%\media-downloader\vendor\` 에 설치하고,
그쪽을 번들 파일보다 먼저 사용한다. 번들된 yt-dlp가 오래돼도 동작하지만, 첫 실행 때 업데이트를 받는다.

## 동작 메모

- yt-dlp는 `cmd.exe /c "chcp 65001 && ..."` 로 실행한다. `windowsVerbatimArguments: true` 가 없으면
  Node가 명령 안의 `"` 를 `\"` 로 바꿔 cmd가 경로를 못 읽는다.
- yt-dlp는 `PYTHONIOENCODING` 을 무시하고 CP949로 출력하므로 `--encoding utf-8` 을 항상 붙인다.
- PC에 Node.js v22+ 가 있으면 `--js-runtimes node:<경로>` 로 넘긴다 (YouTube 추출용 JS 런타임).
  `vendor/deno.exe` 를 두면 그쪽을 우선 사용한다.

## 아이콘 수정

`assets/icon.svg` 가 원본이다. 수정한 뒤 .ico(16~256px)로 다시 만든다:

```bash
chrome --headless=new --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 --screenshot=icon_1024.png assets/icon.svg
python -c "from PIL import Image; Image.open('icon_1024.png').convert('RGBA').resize((256,256), Image.LANCZOS).save('assets/icon.ico', sizes=[(s,s) for s in (16,24,32,48,64,128,256)])"
```

배포 폴더의 exe 아이콘만 바꿀 때는 electron-builder 캐시의 rcedit를 쓴다:
`rcedit-x64.exe "Media Downloader.exe" --set-icon assets/icon.ico`
