import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const targetUrl = process.env.MONITOR_URL ?? "https://lkbio.net";
const chromePath = process.env.CHROME_PATH;
const maxAttempts = Number(process.env.MONITOR_ATTEMPTS ?? 3);
const artifactDir = path.resolve(
  process.env.MONITOR_ARTIFACT_DIR ?? "monitor-artifacts",
);

if (!chromePath) {
  throw new Error("CHROME_PATH가 설정되지 않았습니다.");
}

await mkdir(artifactDir, { recursive: true });

const attempts = [];
let lastError;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let browser;
  let page;

  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: "ko-KR",
    });

    const response = await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    if (!response) {
      throw new Error("문서 응답을 받지 못했습니다.");
    }

    const status = response.status();
    if (status !== 200) {
      throw new Error(`예상 HTTP 200, 실제 HTTP ${status}`);
    }

    const title = (await page.title()).trim();
    if (!/(LK BIO|엘케이바이오)/i.test(title)) {
      throw new Error(`페이지 제목이 예상과 다릅니다: ${title || "(비어 있음)"}`);
    }

    const heading = page.locator("h1").first();
    await heading.waitFor({ state: "visible", timeout: 10_000 });
    const headingText = (await heading.innerText()).replace(/\s+/g, " ").trim();
    if (headingText.length < 10) {
      throw new Error("핵심 제목(H1)이 정상적으로 렌더링되지 않았습니다.");
    }

    const logo = page.locator("header .logo img").first();
    await logo.waitFor({ state: "attached", timeout: 10_000 });
    const logoLoaded = await logo.evaluate(
      (image) => image.complete && image.naturalWidth > 0,
    );
    if (!logoLoaded) {
      throw new Error("헤더 로고 이미지가 로드되지 않았습니다.");
    }

    const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const blockingMessages = [
      "registrar services for this domain have been suspended",
      "email verification required",
      "error 1016",
      "origin dns error",
    ];
    const blockingMessage = blockingMessages.find((message) =>
      bodyText.toLowerCase().includes(message),
    );
    if (blockingMessage) {
      throw new Error(`Cloudflare 장애 문구가 노출되었습니다: ${blockingMessage}`);
    }
    if (bodyText.length < 300) {
      throw new Error("본문 콘텐츠가 충분히 렌더링되지 않았습니다.");
    }

    const result = {
      ok: true,
      attempt,
      checkedAt: new Date().toISOString(),
      requestedUrl: targetUrl,
      finalUrl: page.url(),
      status,
      title,
      heading: headingText,
    };
    attempts.push(result);
    await writeDiagnostics({ ok: true, attempts });
    await writeStepSummary(result);
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    const result = {
      ok: false,
      attempt,
      checkedAt: new Date().toISOString(),
      requestedUrl: targetUrl,
      finalUrl: page?.url() ?? null,
      error: lastError.message,
    };
    attempts.push(result);
    console.error(`점검 ${attempt}/${maxAttempts} 실패: ${lastError.message}`);

    if (page) {
      await page
        .screenshot({
          path: path.join(artifactDir, `failure-attempt-${attempt}.png`),
          fullPage: true,
        })
        .catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

await writeDiagnostics({ ok: false, attempts });
throw new Error(
  `${maxAttempts}회 모두 운영 사이트 점검에 실패했습니다: ${lastError?.message}`,
);

async function writeDiagnostics(payload) {
  await writeFile(
    path.join(artifactDir, "diagnostics.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function writeStepSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const summary = [
    "## LK BIO 운영 사이트 점검 성공",
    "",
    `- URL: ${result.finalUrl}`,
    `- HTTP 상태: ${result.status}`,
    `- 제목: ${result.title}`,
    `- 확인 시각: ${result.checkedAt}`,
    `- 성공 시도: ${result.attempt}/${maxAttempts}`,
    "",
  ].join("\n");
  await writeFile(summaryPath, summary, { encoding: "utf8", flag: "a" });
}
