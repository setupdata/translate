const http = require("http");

const MOCK_HOST = "127.0.0.1";
const MOCK_PORT = 43120;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function requestTranslation(sourceText) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ sourceText }), "utf8");
    const request = http.request(
      {
        hostname: MOCK_HOST,
        port: MOCK_PORT,
        path: "/translate",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": body.byteLength,
        },
      },
      (response) => {
        const chunks = [];
        let responseBytes = 0;

        response.on("data", (chunk) => {
          responseBytes += chunk.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("模拟服务响应过大。"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");

          if (response.statusCode !== 200) {
            reject(new Error(`模拟服务返回了 HTTP ${response.statusCode ?? "未知"}。`));
            return;
          }

          try {
            const payload = JSON.parse(responseBody);
            if (typeof payload.translation !== "string") {
              throw new Error("响应中没有纯文本译文。");
            }
            resolve(payload.translation);
          } catch (error) {
            reject(error instanceof Error ? error : new Error("无法解析模拟服务响应。"));
          }
        });
      },
    );

    request.setTimeout(10_000, () => {
      request.destroy(new Error("连接本地模拟服务超时。"));
    });
    request.on("error", reject);
    request.end(body);
  });
}

window.ruyiTranslation = Object.freeze({
  translate: requestTranslation,
});
