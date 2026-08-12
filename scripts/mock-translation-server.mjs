import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = 43120;
const MAX_REQUEST_BYTES = 1024 * 1024;
const TRANSLATION = "这是受控本地模拟服务返回的纯译文。";

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/translate") {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const chunks = [];
  let requestBytes = 0;

  request.on("data", (chunk) => {
    requestBytes += chunk.length;
    if (requestBytes > MAX_REQUEST_BYTES) {
      response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "request_too_large" }));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", () => {
    if (response.writableEnded) {
      return;
    }

    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof payload.sourceText !== "string" || payload.sourceText.trim() === "") {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "invalid_source_text" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ translation: TRANSLATION }));
    } catch {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "invalid_json" }));
    }
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`如意翻译模拟服务已启动：http://${HOST}:${PORT}\n`);
});

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
