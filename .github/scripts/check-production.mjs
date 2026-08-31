import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const targetUrl = process.env.MONITOR_URL ?? "https://lkbio.net";
const chromePath = process.env.CHROME_PATH;
const maxAttempts = Number(process.env.MONITOR_ATTEMPTS ?? 3);
const artifactDir = path.resolve(
  process.env.MONITOR_ARTIFACT_DIR ?? "monitor-artifacts",
);

if (!chromePath) {
  throw new Error("CHROME_PATH가 설정되지 않았습니다.");
}
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
  throw new Error("MONITOR_ATTEMPTS는 1 이상의 정수여야 합니다.");
}

await mkdir(artifactDir, { recursive: true });

const attempts = [];
let lastError;
let successResult;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let chrome;
  let cdp;

  try {
    chrome = await startChrome();
    cdp = await connectCdp(chrome.pageWebSocketUrl);

    await cdp.send("Page.enable");
    await cdp.send("Network.enable");

    let documentResponse;
    cdp.on("Network.responseReceived", (params) => {
      if (params.type === "Document") documentResponse = params.response;
    });

    const loaded = cdp.waitFor("Page.loadEventFired", 30_000);
    const navigation = await cdp.send("Page.navigate", { url: targetUrl });
    if (navigation.errorText) {
      throw new Error(`페이지 이동 실패: ${navigation.errorText}`);
    }
    await loaded;

    const pageState = await evaluatePageState(cdp);
    const status = Math.round(
      documentResponse?.status ?? pageState.navigationStatus ?? 0,
    );

    if (status !== 200) {
      throw new Error(`예상 HTTP 200, 실제 HTTP ${status || "확인 불가"}`);
    }
    if (!/(LK BIO|엘케이바이오)/i.test(pageState.title)) {
      throw new Error(
        `페이지 제목이 예상과 다릅니다: ${pageState.title || "(비어 있음)"}`,
      );
    }
    if (!pageState.headingVisible || pageState.headingText.length < 10) {
      throw new Error("핵심 제목(H1)이 정상적으로 렌더링되지 않았습니다.");
    }
    if (!pageState.logoLoaded) {
      throw new Error("헤더 로고 이미지가 로드되지 않았습니다.");
    }

    const blockingMessages = [
      "registrar services for this domain have been suspended",
      "email verification required",
      "error 1016",
      "origin dns error",
    ];
    const blockingMessage = blockingMessages.find((message) =>
      pageState.bodyText.toLowerCase().includes(message),
    );
    if (blockingMessage) {
      throw new Error(`Cloudflare 장애 문구가 노출되었습니다: ${blockingMessage}`);
    }
    if (pageState.bodyText.length < 300) {
      throw new Error("본문 콘텐츠가 충분히 렌더링되지 않았습니다.");
    }

    successResult = {
      ok: true,
      attempt,
      checkedAt: new Date().toISOString(),
      requestedUrl: targetUrl,
      finalUrl: pageState.finalUrl,
      status,
      title: pageState.title,
      heading: pageState.headingText,
    };
    attempts.push(successResult);
    await writeDiagnostics({ ok: true, attempts });
    await writeStepSummary(successResult);
    console.log(JSON.stringify(successResult, null, 2));
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    const result = {
      ok: false,
      attempt,
      checkedAt: new Date().toISOString(),
      requestedUrl: targetUrl,
      error: lastError.message,
    };
    attempts.push(result);
    console.error(`점검 ${attempt}/${maxAttempts} 실패: ${lastError.message}`);

    if (cdp) {
      await saveScreenshot(cdp, attempt).catch(() => undefined);
    }
  } finally {
    await cdp?.close().catch(() => undefined);
    await stopChrome(chrome).catch(() => undefined);
  }

  if (successResult) break;
  if (attempt < maxAttempts) await delay(5_000);
}

if (!successResult) {
  await writeDiagnostics({ ok: false, attempts });
  throw new Error(
    `${maxAttempts}회 모두 운영 사이트 점검에 실패했습니다: ${lastError?.message}`,
  );
}

async function startChrome() {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "lkbio-monitor-"));
  const activePortFile = path.join(profileDir, "DevToolsActivePort");
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--window-size=1440,1000",
    "about:blank",
  ];
  const child = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });

  try {
    const deadline = Date.now() + 15_000;
    let port;

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Chrome이 조기 종료되었습니다. ${stderr.trim()}`);
      }
      try {
        const [portText] = (await readFile(activePortFile, "utf8")).trim().split("\n");
        port = Number(portText);
        if (Number.isInteger(port) && port > 0) break;
      } catch {
        // Chrome이 DevTools 포트 파일을 만들 때까지 기다린다.
      }
      await delay(100);
    }

    if (!port) throw new Error("Chrome DevTools 포트를 확인하지 못했습니다.");

    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
      (response) => response.json(),
    );
    const pageTarget = targets.find((target) => target.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error("Chrome 페이지 디버깅 대상을 찾지 못했습니다.");
    }

    return { child, profileDir, pageWebSocketUrl: pageTarget.webSocketDebuggerUrl };
  } catch (error) {
    child.kill("SIGTERM");
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}

async function stopChrome(chrome) {
  if (!chrome) return;
  if (chrome.child.exitCode === null) {
    chrome.child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.child.once("exit", resolve)),
      delay(3_000),
    ]);
    if (chrome.child.exitCode === null) chrome.child.kill("SIGKILL");
  }
  await rm(chrome.profileDir, { recursive: true, force: true });
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Chrome DevTools 연결 시간이 초과되었습니다.")),
      10_000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Chrome DevTools 연결에 실패했습니다."));
    });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) {
      listener(message.params ?? {});
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const methodListeners = listeners.get(method) ?? [];
      methodListeners.push(listener);
      listeners.set(method, methodListeners);
    },
    waitFor(method, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`${method} 이벤트 대기 시간이 초과되었습니다.`)),
          timeoutMs,
        );
        const once = (params) => {
          clearTimeout(timeout);
          resolve(params);
        };
        const methodListeners = listeners.get(method) ?? [];
        methodListeners.push(once);
        listeners.set(method, methodListeners);
      });
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      socket.close();
      await Promise.race([
        new Promise((resolve) => socket.addEventListener("close", resolve, { once: true })),
        delay(1_000),
      ]);
    },
  };
}

async function evaluatePageState(cdp) {
  const evaluation = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        if (document.fonts?.ready) await document.fonts.ready;

        const logo = document.querySelector('header .logo img');
        if (logo && !logo.complete) {
          await Promise.race([
            new Promise((resolve) => {
              logo.addEventListener('load', resolve, { once: true });
              logo.addEventListener('error', resolve, { once: true });
            }),
            delay(10_000),
          ]);
        }

        const heading = document.querySelector('h1');
        const headingStyle = heading ? getComputedStyle(heading) : null;
        const headingRect = heading?.getBoundingClientRect();
        const navigation = performance.getEntriesByType('navigation')[0];

        return {
          finalUrl: location.href,
          title: document.title.trim(),
          headingText: (heading?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
          headingVisible: Boolean(
            heading &&
            headingRect?.width > 0 &&
            headingRect?.height > 0 &&
            headingStyle?.visibility !== 'hidden' &&
            headingStyle?.display !== 'none'
          ),
          logoLoaded: Boolean(logo?.complete && logo?.naturalWidth > 0),
          bodyText: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
          navigationStatus: navigation?.responseStatus ?? 0,
        };
      })()
    `,
  });

  if (evaluation.exceptionDetails) {
    throw new Error("페이지 상태 확인 스크립트 실행에 실패했습니다.");
  }
  return evaluation.result.value;
}

async function saveScreenshot(cdp, attempt) {
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  await writeFile(
    path.join(artifactDir, `failure-attempt-${attempt}.png`),
    Buffer.from(screenshot.data, "base64"),
  );
}

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
