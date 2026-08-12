const http = require("http");
const https = require("https");

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_NO_DATA_TIMEOUT_MILLISECONDS = 60_000;
const DEFAULT_TOTAL_TIMEOUT_MILLISECONDS = 10 * 60_000;
const MAX_SAME_ORIGIN_REDIRECTS = 3;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function selectClient(url) {
  if (url.username || url.password) {
    const error = new Error("模型服务地址不能包含用户名或密码。");
    error.code = "configuration_error";
    throw error;
  }
  if (url.protocol === "https:") {
    return https;
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return http;
  }
  const error = new Error(
    "模型服务地址必须使用 HTTPS；HTTP 仅允许本机回环地址。",
  );
  error.code = "configuration_error";
  throw error;
}

function lifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeMessage = message;
  return error;
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function createNodeChatTransport({
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  noDataTimeoutMilliseconds = DEFAULT_NO_DATA_TIMEOUT_MILLISECONDS,
  totalTimeoutMilliseconds = DEFAULT_TOTAL_TIMEOUT_MILLISECONDS,
} = {}) {
  function requestOnce({
      url,
      method,
      headers,
      body = "",
      onData,
      signal,
      maxResponseBytes: requestMaxResponseBytes = maxResponseBytes,
      noDataTimeoutMilliseconds: requestNoDataTimeoutMilliseconds =
        noDataTimeoutMilliseconds,
      totalTimeoutMilliseconds: requestTotalTimeoutMilliseconds =
        totalTimeoutMilliseconds,
    }) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
          reject(lifecycleError("cancelled", "请求已取消。"));
          return;
        }

        let parsedUrl;
        let client;
        try {
          parsedUrl = new URL(url);
          client = selectClient(parsedUrl);
        } catch (error) {
          reject(error);
          return;
        }

        const hasBody =
          method !== "GET" && method !== "HEAD" && typeof body === "string";
        const encodedBody = hasBody ? Buffer.from(body, "utf8") : null;
        let request;
        let response;
        let settled = false;
        let responseBytes = 0;
        const chunks = [];
        let noDataTimer;
        let totalTimer;

        function clearTimers() {
          if (noDataTimer) {
            clearTimeout(noDataTimer);
          }
          if (totalTimer) {
            clearTimeout(totalTimer);
          }
        }

        function removeAbortListener() {
          if (signal) {
            signal.removeEventListener("abort", handleAbort);
          }
        }

        function finishError(error) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimers();
          removeAbortListener();
          if (response && !response.destroyed) {
            response.destroy();
          }
          if (request && !request.destroyed) {
            request.destroy();
          }
          reject(error);
        }

        function finishSuccess(result) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimers();
          removeAbortListener();
          resolve(result);
        }

        function restartNoDataTimer() {
          if (noDataTimer) {
            clearTimeout(noDataTimer);
          }
          noDataTimer = setTimeout(() => {
            finishError(lifecycleError("timeout", "模型服务连续一段时间没有返回数据。"));
          }, requestNoDataTimeoutMilliseconds);
        }

        function handleAbort() {
          finishError(lifecycleError("cancelled", "请求已取消。"));
        }

        try {
          request = client.request(
            parsedUrl,
            {
              method,
              headers: {
                ...headers,
                ...(encodedBody
                  ? { "Content-Length": encodedBody.byteLength }
                  : {}),
              },
            },
            (incomingResponse) => {
              response = incomingResponse;
              response.on("data", (chunk) => {
                if (settled) {
                  return;
                }
                restartNoDataTimer();
                responseBytes += chunk.length;
                if (responseBytes > requestMaxResponseBytes) {
                  finishError(
                    lifecycleError(
                      "response_too_large",
                      "模型服务响应超过大小限制。",
                    ),
                  );
                  return;
                }
                chunks.push(chunk);
                if (
                  incomingResponse.statusCode >= 200 &&
                  incomingResponse.statusCode < 300 &&
                  typeof onData === "function"
                ) {
                  try {
                    onData(chunk);
                  } catch (error) {
                    finishError(error);
                  }
                }
              });
              response.on("error", (error) => finishError(error));
              response.on("end", () => {
                if (!incomingResponse.complete) {
                  finishError(
                    lifecycleError("network_error", "模型服务响应提前中断。"),
                  );
                  return;
                }
                finishSuccess({
                  status: incomingResponse.statusCode || 0,
                  headers: { ...incomingResponse.headers },
                  body: Buffer.concat(chunks).toString("utf8"),
                  complete: true,
                });
              });
              response.on("close", () => {
                if (!settled && !incomingResponse.complete) {
                  finishError(
                    lifecycleError("network_error", "模型服务响应提前关闭。"),
                  );
                }
              });
            },
          );
        } catch (error) {
          finishError(error);
          return;
        }

        request.on("error", (error) => {
          if (settled) {
            return;
          }
          finishError(error);
        });
        if (signal) {
          signal.addEventListener("abort", handleAbort, { once: true });
          if (signal.aborted) {
            handleAbort();
            return;
          }
        }
        restartNoDataTimer();
        totalTimer = setTimeout(() => {
          finishError(lifecycleError("timeout", "模型服务请求超过总时限。"));
        }, requestTotalTimeoutMilliseconds);
        try {
          request.end(encodedBody || undefined);
        } catch (error) {
          finishError(error);
        }
      });
  }

  async function requestWithRedirects(
    options,
    redirectCount = 0,
    initialOrigin = null,
    totalDeadline = null,
  ) {
    let parsedUrl;
    try {
      parsedUrl = new URL(options.url);
      selectClient(parsedUrl);
    } catch (error) {
      throw error;
    }
    const allowedOrigin = initialOrigin || parsedUrl.origin;
    const configuredTotalTimeout =
      options.totalTimeoutMilliseconds ?? totalTimeoutMilliseconds;
    const deadline = totalDeadline ?? Date.now() + configuredTotalTimeout;
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) {
      throw lifecycleError("timeout", "模型服务请求超过总时限。");
    }

    const response = await requestOnce({
      ...options,
      totalTimeoutMilliseconds: remainingMilliseconds,
    });
    const location = response.headers && response.headers.location;
    if (!isRedirectStatus(response.status) || typeof location !== "string") {
      return response;
    }
    if (redirectCount >= MAX_SAME_ORIGIN_REDIRECTS) {
      throw lifecycleError("request_rejected", "模型服务重定向次数超过限制。");
    }

    let redirectedUrl;
    try {
      redirectedUrl = new URL(location, parsedUrl);
      selectClient(redirectedUrl);
    } catch (error) {
      throw error;
    }
    if (redirectedUrl.origin !== allowedOrigin) {
      const error = lifecycleError(
        "request_rejected",
        `模型服务尝试重定向到不同来源：${redirectedUrl.origin}`,
      );
      error.redirectOrigin = redirectedUrl.origin;
      throw error;
    }
    return requestWithRedirects(
      { ...options, url: redirectedUrl.toString() },
      redirectCount + 1,
      allowedOrigin,
      deadline,
    );
  }

  return Object.freeze({
    request: requestWithRedirects,
  });
}

module.exports = {
  createNodeChatTransport,
};
