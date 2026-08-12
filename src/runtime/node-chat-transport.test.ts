import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const transportPath = resolve(
  import.meta.dirname,
  "../../public/lib/node-chat-transport.cjs",
);

const openServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose, reject) => {
          server.close((error) => (error ? reject(error) : resolveClose()));
        }),
    ),
  );
});

describe("Node chat transport", () => {
  it("posts the exact request and returns the complete SSE body", async () => {
    const credentialFixture = `fixture-${randomUUID()}`;
    let receivedBody = "";
    let receivedAuthorization = "";
    const server = createServer((request, response) => {
      receivedAuthorization = String(request.headers.authorization ?? "");
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        receivedBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Request-Id": "request-local",
        });
        response.end('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');
      });
    });
    openServers.push(server);
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("测试服务没有可用端口。");
    }
    const { createNodeChatTransport } = require(transportPath);
    const transport = createNodeChatTransport();

    const result = await transport.request({
      url: `http://127.0.0.1:${address.port}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${credentialFixture}`,
      },
      body: '{"model":"deepseek-v4-flash"}',
    });

    expect(receivedAuthorization).toBe(`Bearer ${credentialFixture}`);
    expect(receivedBody).toBe('{"model":"deepseek-v4-flash"}');
    expect(result).toEqual({
      status: 200,
      headers: expect.objectContaining({ "x-request-id": "request-local" }),
      body: 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n',
    });
  });
});
