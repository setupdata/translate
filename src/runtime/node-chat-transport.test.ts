import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("accepts IPv6 loopback HTTP and rejects URL credentials", async () => {
    const { createNodeChatTransport } = require(transportPath);
    const transport = createNodeChatTransport();

    await expect(
      transport.request({
        url: "http://user:password@127.0.0.1:1/chat/completions",
        method: "POST",
        headers: {},
        body: "{}",
      }),
    ).rejects.toMatchObject({ code: "configuration_error" });

    const pending = transport.request({
      url: "http://[::1]:1/chat/completions",
      method: "POST",
      headers: {},
      body: "{}",
    });
    await expect(pending).rejects.not.toMatchObject({ code: "configuration_error" });
  });

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
      complete: true,
    });
  });

  it("streams each response chunk and refreshes the no-data timer", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"一"}}]}\n\n');
      setTimeout(() => {
        response.end('data: {"choices":[{"delta":{"content":"二"}}]}\n\ndata: [DONE]\n\n');
      }, 20);
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
    const onData = vi.fn();
    const transport = createNodeChatTransport({
      noDataTimeoutMilliseconds: 100,
      totalTimeoutMilliseconds: 1_000,
    });

    const pending = transport.request({
      url: `http://127.0.0.1:${address.port}/chat/completions`,
      method: "POST",
      headers: {},
      body: "{}",
      onData,
    });
    const result = await pending;

    expect(onData).toHaveBeenCalledTimes(2);
    expect(Buffer.concat(onData.mock.calls.map(([chunk]) => chunk)).toString()).toContain(
      "data: [DONE]",
    );
    expect(result.complete).toBe(true);
  });

  it("supports bodyless GET requests and request-specific response limits", async () => {
    let receivedMethod = "";
    let receivedBody = "";
    let receivedContentLength: string | undefined;
    const server = createServer((request, response) => {
      receivedMethod = request.method ?? "";
      receivedContentLength = request.headers["content-length"];
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        receivedBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"data":[{"id":"model-a"}]}');
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
    const url = `http://127.0.0.1:${address.port}/models`;

    const result = await transport.request({
      url,
      method: "GET",
      headers: {},
      body: "",
      maxResponseBytes: 1_024,
      noDataTimeoutMilliseconds: 1_000,
      totalTimeoutMilliseconds: 1_000,
    });
    expect(result.status).toBe(200);
    expect(receivedMethod).toBe("GET");
    expect(receivedBody).toBe("");
    expect(receivedContentLength).toBeUndefined();

    await expect(
      transport.request({
        url,
        method: "GET",
        headers: {},
        body: "",
        maxResponseBytes: 8,
        noDataTimeoutMilliseconds: 1_000,
        totalTimeoutMilliseconds: 1_000,
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("follows same-origin redirects", async () => {
    const visitedPaths: string[] = [];
    const server = createServer((request, response) => {
      visitedPaths.push(request.url ?? "");
      if (request.url === "/start") {
        response.writeHead(302, { Location: "/models" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"data":[{"id":"model-a"}]}');
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
      url: `http://127.0.0.1:${address.port}/start`,
      method: "GET",
      headers: {},
      body: "",
    });

    expect(result).toMatchObject({ status: 200, complete: true });
    expect(visitedPaths).toEqual(["/start", "/models"]);
  });

  it("stops cross-origin redirects and limits same-origin redirects to three", async () => {
    let crossOriginTargetCalls = 0;
    const targetServer = createServer((_request, response) => {
      crossOriginTargetCalls += 1;
      response.end("unexpected");
    });
    openServers.push(targetServer);
    await new Promise<void>((resolveListen) =>
      targetServer.listen(0, "127.0.0.1", resolveListen),
    );
    const targetAddress = targetServer.address();
    if (!targetAddress || typeof targetAddress === "string") {
      throw new Error("测试服务没有可用端口。");
    }
    const targetOrigin = `http://127.0.0.1:${targetAddress.port}`;

    const sourceServer = createServer((request, response) => {
      if (request.url === "/cross-origin") {
        response.writeHead(302, { Location: `${targetOrigin}/target` });
        response.end();
        return;
      }
      const redirectIndex = Number((request.url ?? "").slice(6)) || 0;
      response.writeHead(302, { Location: `/loop-${redirectIndex + 1}` });
      response.end();
    });
    openServers.push(sourceServer);
    await new Promise<void>((resolveListen) =>
      sourceServer.listen(0, "127.0.0.1", resolveListen),
    );
    const sourceAddress = sourceServer.address();
    if (!sourceAddress || typeof sourceAddress === "string") {
      throw new Error("测试服务没有可用端口。");
    }
    const sourceOrigin = `http://127.0.0.1:${sourceAddress.port}`;
    const { createNodeChatTransport } = require(transportPath);
    const transport = createNodeChatTransport();

    await expect(
      transport.request({
        url: `${sourceOrigin}/cross-origin`,
        method: "GET",
        headers: {},
        body: "",
      }),
    ).rejects.toMatchObject({
      code: "request_rejected",
      redirectOrigin: targetOrigin,
    });
    expect(crossOriginTargetCalls).toBe(0);

    await expect(
      transport.request({
        url: `${sourceOrigin}/loop-0`,
        method: "GET",
        headers: {},
        body: "",
      }),
    ).rejects.toMatchObject({ code: "request_rejected" });
  });

  it("classifies user abort, no-data timeout, and total timeout", async () => {
    const { createNodeChatTransport } = require(transportPath);

    for (const testCase of [
      { expectedCode: "cancelled", noData: 1_000, total: 2_000, abort: true },
      { expectedCode: "timeout", noData: 10, total: 2_000, abort: false },
      { expectedCode: "timeout", noData: 2_000, total: 10, abort: false },
    ]) {
      const server = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.flushHeaders();
      });
      openServers.push(server);
      await new Promise<void>((resolveListen) =>
        server.listen(0, "127.0.0.1", resolveListen),
      );
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("测试服务没有可用端口。");
      }
      const controller = new AbortController();
      const transport = createNodeChatTransport({
        noDataTimeoutMilliseconds: testCase.noData,
        totalTimeoutMilliseconds: testCase.total,
      });
      const pending = transport.request({
        url: `http://127.0.0.1:${address.port}/chat/completions`,
        method: "POST",
        headers: {},
        body: "{}",
        signal: controller.signal,
      });
      if (testCase.abort) {
        controller.abort();
      }

      await expect(pending).rejects.toMatchObject({ code: testCase.expectedCode });
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      openServers.pop();
    }
  });
});
