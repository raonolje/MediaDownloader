# Media Downloader — 소스 복구 기록

- **복구일:** 2026-09-23
- **원본:** `E:\MediaDownloader_Portable\resources\app.asar` (배포된 포터블 앱)
- **버전:** package.json 1.0.0 (2026-05-14 빌드)
- **경위:** 마누스 사태 때 원본 소스가 삭제되어, 배포 폴더의 app.asar에서 추출

## 복구된 것 / 안 된 것

**온전히 복구됨** — `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`,
`package.json`(electron-builder 설정 포함), `assets/icon.ico`.
asar는 압축·난독화가 없어 원본 그대로다.

**다시 구함** — `vendor/`: ffmpeg/ffprobe 8.1.1(gyan.dev essentials)은 배포 폴더에서,
yt-dlp는 공식 릴리스 2026.08.19.

**복구 불가** — `package-lock.json`(정확한 의존성 버전), 커밋 이력, asar에 들어가지 않은 개발용 파일.
의존성은 package.json 범위(`electron ^33.4.11`, `electron-builder ^25.1.8`)로 다시 설치된다.

## 복구하면서 확인한 것

- `dependencies` 의 `iconv-lite` 는 코드 어디에서도 쓰지 않는다 (남겨 둠).
- 기존 빌드 결과물에는 `resources\vendor\vendor\` 로 도구가 한 번 더 중복 들어가 있었다
  (원본 vendor 폴더 안에 vendor 폴더가 있었던 것으로 보임, 약 220MB 낭비).
  이 폴더의 `vendor/` 는 정리된 상태라 다시 빌드하면 중복이 없어진다.
- 복구한 package.json 그대로 빌드하면 `vendor/*.exe`(220MB)가 app.asar 안에도 들어간다.
  배포본 app.asar는 빌드보다 26분 늦게 만들어졌고 devDependencies에 `@electron/asar`가 있어,
  원 저자가 빌드 후 asar를 손으로 다시 만든 것으로 보인다.
  → `build.files` 에 `!vendor/**`, `!*.md` 를 추가해 빌드만으로 같은 결과가 나오게 했다.
- 2026-09-23 빌드 검증: `npm install` → `npm run build` 성공 (electron 33.4.11, electron-builder 25.1.8).
  app.asar 파일 목록이 배포본과 같고, 코드 파일은 배포본과 바이트 단위로 같다.
  win-unpacked 479MB (배포 폴더는 중복 때문에 691MB).

## 복구 직전에 들어간 변경 (2026-09-23)

이 폴더의 코드는 **아래 수정이 반영된 버전**이다. 수정 전 원본은
`E:\MediaDownloader_Portable\resources\app.asar.bak` 에 있다.

1. **yt-dlp 자동 업데이트** — 시작 시 + 6시간마다 GitHub 최신 릴리스 확인 → SHA-256 검증 후 설치.
   다운로드가 실패하면 새 버전을 확인해 있으면 설치하고 한 번 자동 재시도.
   (계기: yt-dlp 2026.03.17의 `android_vr` 클라이언트가 2026-08-17부터 YouTube에서 403)
2. **cmd.exe 실행 버그 수정** — 출력 파일 리다이렉트가 항상 실패해서 버전 확인, 업데이트 배너,
   미리보기, 파일명 조회가 원래부터 동작하지 않았음 (`windowsVerbatimArguments`).
3. **한글 깨짐 수정** — yt-dlp에 `--encoding utf-8`.
4. **실패를 성공으로 판정하던 문제 수정** — `.part`/조각 파일 제외, 이번 다운로드 시작 이후 파일만 인정.
5. **JS 런타임** — 설치된 Node.js v22+ 를 yt-dlp에 넘김.
