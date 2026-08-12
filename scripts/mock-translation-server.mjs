import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = 43120;
const MAX_REQUEST_BYTES = 1024 * 1024;
const TRANSLATION = "这是受控本地模拟服务返回的纯译文。";
const expectedCredential = process.env.RUYI_MOCK_CREDENTIAL;

if (!expectedCredential) {
  throw new Error("缺少 RUYI_MOCK_CREDENTIAL，模拟服务拒绝启动。");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
    sendJson(response, 401, { error: "authentication_error" });
    return;
  }

  const chunks = [];
  let requestBytes = 0;

  request.on("data", (chunk) => {
    requestBytes += chunk.length;
    if (requestBytes > MAX_REQUEST_BYTES) {
      sendJson(response, 413, { error: "request_too_large" });
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
      const userMessage = payload.messages?.find((message) => message.role === "user");
      const translationInput = JSON.parse(userMessage?.content ?? "null");
      if (
        payload.model !== "deepseek-v4-flash" ||
        payload.stream !== true ||
        payload.thinking?.type !== "disabled" ||
        translationInput?.qualityMode !== "standard" ||
        translationInput?.mode !== "full_document" ||
        typeof translationInput?.sourceText !== "string" ||
        translationInput.sourceText.trim() === ""
      ) {
        sendJson(response, 400, { error: "invalid_translation_request" });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hidden", content: TRANSLATION.slice(0, 10) } }] })}\n\n`,
      );
      response.write(": keep-alive\n\n");
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: TRANSLATION.slice(10) } }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    } catch {
      sendJson(response, 400, { error: "invalid_json" });
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
