# LK BIO Website

LK BIO 회사 소개 웹사이트의 소스 저장소입니다.

## 운영 링크

- 운영 사이트: <https://lkbio.net>
- Cloudflare 기본 주소: <https://lkbio-website.pages.dev>
- 검수 사이트: <https://dev.lkbio-website.pages.dev>
- Cloudflare Pages 관리: <https://dash.cloudflare.com/7c37e3b0bb474417fc8124fc61cdbbbf/pages/view/lkbio-website>
- GitHub Issues: <https://github.com/lkbio-company/lkbio-website/issues>

이 사이트는 `index.html`로 구성된 정적 사이트입니다. 별도의 서버, 데이터베이스 또는 빌드 과정이 필요하지 않습니다.

## 브랜치와 배포 환경

- `dev`: 검수 환경입니다. 변경 사항을 먼저 이 브랜치에 반영하면 Cloudflare Pages의 `dev.<project>.pages.dev` 미리보기 주소로 자동 배포합니다.
- `main`: 운영 환경입니다. `dev`의 변경 사항을 확인하고 승인한 뒤 Pull Request로 병합할 때만 운영 사이트에 자동 배포합니다.

변경 흐름은 다음과 같습니다. 세부 에이전트 규칙은 [`AGENTS.md`](AGENTS.md)를 따릅니다.

1. 요청을 유형별 GitHub Issue로 등록합니다.
2. 작업 PR을 `dev`로 병합하고 검수 사이트에서 자동·사람 검수를 진행합니다.
3. 승인된 변경을 `dev` → `main` 릴리스 PR로 묶고 관련 Issue와 변경 요약을 남깁니다.
4. `main` 병합 후 운영 사이트 반영을 확인합니다.

Cloudflare Pages 설정은 Production branch를 `main`, Preview branch를 `dev`로 제한합니다. Preview 배포에는 검색엔진 색인을 막는 `X-Robots-Tag: noindex`가 기본 적용됩니다.

이전 직접 업로드 테스트 주소 `lkbio-ddg.pages.dev`는 신규 운영 주소 확인이 끝날 때까지만 유지합니다.

## 운영 사이트 자동 점검

GitHub Actions의 `Production website monitor` 워크플로가 매시 17분과 47분에 실제 Chrome으로 운영 사이트를 확인합니다. HTTP 200 응답, 페이지 제목과 핵심 콘텐츠 렌더링, 로고 이미지 로딩, Cloudflare 장애 문구 노출 여부를 최대 3회 점검합니다.

3회 모두 실패하면 `bug`, `type:ops`, `troubleshooting` 라벨이 붙은 장애 이슈를 중복 없이 만들고 `@wonjerry`를 호출합니다. 실패 화면과 진단 JSON은 해당 Actions 실행의 artifact에서 14일간 확인할 수 있습니다. 이후 점검이 성공하면 자동으로 복구 댓글을 남기고 장애 이슈를 닫습니다.

필요할 때는 GitHub의 **Actions → Production website monitor → Run workflow**에서 수동으로 실행할 수 있습니다.
