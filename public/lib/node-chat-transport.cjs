const http = require("http");
const https = require("https");

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_NO_DATA_TIMEOUT_MILLISECONDS = 60_000;
const DEFAULT_TOTAL_TIMEOUT_MILLISECONDS = 10 * 60_000;
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

function createNodeChatTransport({
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  noDataTimeoutMilliseconds = DEFAULT_NO_DATA_TIMEOUT_MILLISECONDS,
  totalTimeoutMilliseconds = DEFAULT_TOTAL_TIMEOUT_MILLISECONDS,
} = {}) {
  return Object.freeze({
    request({ url, method, headers, body, onData, signal }) {
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

        const encodedBody = Buffer.from(body, "utf8");
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
            finishError(lifecycleError("timeout", "模型服务连续 60 秒没有返回数据。"));
          }, noDataTimeoutMilliseconds);
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
                "Content-Length": encodedBody.byteLength,
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
                if (responseBytes > maxResponseBytes) {
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
          finishError(lifecycleError("timeout", "模型服务请求超过 10 分钟。"));
        }, totalTimeoutMilliseconds);
        try {
          request.end(encodedBody);
        } catch (error) {
          finishError(error);
        }
      });
    },
  });
}

module.exports = {
  createNodeChatTransport,
};
