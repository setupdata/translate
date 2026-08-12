const http = require("http");
const https = require("https");

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MILLISECONDS = 60_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function selectClient(url) {
  if (url.protocol === "https:") {
    return https;
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return http;
  }
  throw new Error("模型服务地址必须使用 HTTPS；HTTP 仅允许本机回环地址。");
}

function createNodeChatTransport({
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
} = {}) {
  return Object.freeze({
    request({ url, method, headers, body }) {
      return new Promise((resolve, reject) => {
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
        const request = client.request(
          parsedUrl,
          {
            method,
            headers: {
              ...headers,
              "Content-Length": encodedBody.byteLength,
            },
          },
          (response) => {
            const chunks = [];
            let responseBytes = 0;

            response.on("data", (chunk) => {
              responseBytes += chunk.length;
              if (responseBytes > maxResponseBytes) {
                request.destroy(new Error("模型服务响应超过大小限制。"));
                return;
              }
              chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                headers: { ...response.headers },
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );

        request.setTimeout(timeoutMilliseconds, () => {
          request.destroy(new Error("模型服务请求超时。"));
        });
        request.on("error", reject);
        request.end(encodedBody);
      });
    },
  });
}

module.exports = {
  createNodeChatTransport,
};
