# LK BIO Website

LK BIO 회사 소개 웹사이트의 소스 저장소입니다.

## 구성

- `index.html`: 정적 웹사이트 전체 소스
- 현재 직접 업로드 Pages 프로젝트: `lkbio`
- 현재 공개 주소(전환 전): <https://lkbio-ddg.pages.dev>

## 브랜치와 배포 환경

- `dev`: 검수 환경입니다. 변경 사항을 먼저 이 브랜치에 반영하면 Cloudflare Pages의 `dev.<project>.pages.dev` 미리보기 주소로 자동 배포합니다.
- `main`: 운영 환경입니다. `dev`의 변경 사항을 확인하고 승인한 뒤 Pull Request로 병합할 때만 운영 사이트에 자동 배포합니다.

권장 변경 흐름은 다음과 같습니다.

1. 작업 브랜치에서 웹사이트를 수정합니다.
2. 변경 사항을 `dev`로 병합하고 미리보기 주소에서 실제 동작과 UI를 확인합니다.
3. 승인이 끝나면 `dev`에서 `main`으로 Pull Request를 생성해 병합합니다.
4. Cloudflare Pages가 `main`을 운영 사이트에 자동 배포합니다.

Cloudflare Pages 설정은 Production branch를 `main`, Preview branch를 `dev`로 제한합니다. Preview 배포에는 검색엔진 색인을 막는 `X-Robots-Tag: noindex`가 기본 적용됩니다.

## 최초 전환

현재 `lkbio` 프로젝트는 Direct Upload 방식입니다. Git 연동 방식으로 변경할 수 없으므로 GitHub 저장소를 연결한 새 Pages 프로젝트를 만들고, 운영 검수 후 사용자 도메인을 새 프로젝트로 연결합니다. 전환 전까지 현재 사이트는 그대로 유지합니다.

현재 사이트는 별도의 서버, 데이터베이스 또는 빌드 과정이 필요 없는 정적 HTML 사이트입니다.
