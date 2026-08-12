import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const runtimePath = resolve(
  import.meta.dirname,
  "../../public/lib/ruyi-runtime.cjs",
);

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: unknown) =>
      values.set(key, structuredClone(value)),
    removeItem: (key: string) => values.delete(key),
  };
}

function credentialForm(value: string) {
  return {
    elements: {
      namedItem(name: string) {
        return name === "apiKey" ? { value } : null;
      },
    },
  };
}

function responsesPreset(stream: boolean) {
  return {
    id: "custom-responses",
    name: "Custom Responses",
    type: "custom",
    protocol: "responses",
    translationUrl: "https://example.test/v1/responses",
    confirmedTranslationUrl: "https://example.test/v1/responses",
    modelListUrl: "https://example.test/v1/models",
    authentication: "bearer",
    model: "translation-model",
    stream,
  };
}

function translationRequest(taskId: string) {
  return {
    taskId,
    sourceText: "  Hello\n  ",
    targetLanguage: {
      kind: "preset" as const,
      id: "zh-CN",
      modelLabel: "Simplified Chinese",
    },
  };
}

describe("Responses translation adapter", () => {
  const credential = `fixture-${randomUUID()}`;

  it("maps the fixed instructions and JSON input and reads top-level output_text", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({
          output_text: "你好",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "你好" }],
            },
          ],
        }),
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(false),
    });
    await runtime.saveApiKey(credentialForm(credential));

    const result = await runtime.startStandardTranslation(
      translationRequest("responses-normal"),
    );

    expect(result).toEqual({
      status: "completed",
      taskId: "responses-normal",
      translation: "你好",
      quality: { risks: [], pasteBlocked: false },
    });
    const sent = transport.request.mock.calls[0][0];
    const body = JSON.parse(sent.body);
    expect(body).toEqual({
      model: "translation-model",
      instructions: expect.stringContaining(
        "You are the translation stage of Ruyi Translation.",
      ),
      input: expect.any(String),
      stream: false,
    });
    expect(JSON.parse(body.input)).toMatchObject({
      schemaVersion: "translation-input.v1",
      sourceText: "  Hello\n  ",
      qualityMode: "standard",
      mode: "full_document",
      analysis: null,
    });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("thinking");
  });

  it("falls back to ordered output_text message parts for a normal response", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: "你" },
                { type: "output_text", text: "好" },
              ],
            },
          ],
        }),
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(false),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(translationRequest("responses-fallback")),
    ).resolves.toMatchObject({ status: "completed", translation: "你好" });
  });

  it("streams only output_text deltas and requires done before completed", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        for (const event of [
          { type: "response.created", response: { id: "resp-1" } },
          { type: "response.in_progress", response: { id: "resp-1" } },
          {
            type: "response.output_item.added",
            item: { type: "message", id: "message-1" },
          },
          {
            type: "response.content_part.added",
            part: { type: "output_text", text: "" },
          },
          { type: "response.output_text.delta", delta: "你" },
          { type: "response.output_text.delta", delta: "好" },
          { type: "response.output_text.done", text: "你好" },
          {
            type: "response.content_part.done",
            part: { type: "output_text", text: "你好" },
          },
          {
            type: "response.output_item.done",
            item: {
              type: "message",
              content: [{ type: "output_text", text: "你好" }],
            },
          },
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "你好" }],
                },
              ],
            },
          },
        ]) {
          request.onData(
            Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
        return { status: 200, headers: {}, body: "", complete: true };
      }),
    };
    const progress = vi.fn();
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(true),
    });
    await runtime.saveApiKey(credentialForm(credential));

    const result = await runtime.startStandardTranslation(
      translationRequest("responses-stream"),
      progress,
    );

    expect(result).toEqual({
      status: "completed",
      taskId: "responses-stream",
      translation: "你好",
      quality: { risks: [], pasteBlocked: false },
    });
    expect(progress).toHaveBeenCalledWith({
      type: "text_delta",
      taskId: "responses-stream",
      delta: "你",
    });
    expect(progress).toHaveBeenCalledWith({
      type: "text_delta",
      taskId: "responses-stream",
      delta: "好",
    });
  });

  it.each([
    [
      "failed",
      [
        { type: "response.output_text.delta", delta: "部分" },
        { type: "response.failed", response: { status: "failed" } },
      ],
      "server_error",
    ],
    [
      "unknown tool output",
      [
        { type: "response.output_text.delta", delta: "部分" },
        {
          type: "response.output_item.added",
          item: { type: "function_call", name: "tool" },
        },
      ],
      "protocol_error",
    ],
    [
      "completed before output_text.done",
      [
        { type: "response.output_text.delta", delta: "部分" },
        { type: "response.completed", response: { status: "completed" } },
      ],
      "protocol_error",
    ],
    [
      "incomplete",
      [
        { type: "response.output_text.delta", delta: "部分" },
        { type: "response.incomplete", response: { status: "incomplete" } },
      ],
      "request_rejected",
    ],
    [
      "error event",
      [
        { type: "response.output_text.delta", delta: "部分" },
        { type: "error", code: "upstream_error" },
      ],
      "server_error",
    ],
    [
      "unknown output event",
      [
        { type: "response.output_text.delta", delta: "部分" },
        { type: "response.image_generation_call.completed" },
      ],
      "protocol_error",
    ],
  ])("preserves partial text for %s", async (_name, events, code) => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        request.onData(
          Buffer.from(
            'event: response.created\ndata: {"type":"response.created","response":{"id":"response-failure"}}\n\n',
          ),
        );
        for (const event of events) {
          request.onData(
            Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
        return { status: 200, headers: {}, body: "", complete: true };
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(true),
    });
    await runtime.saveApiKey(credentialForm(credential));

    const result = await runtime.startStandardTranslation(
      translationRequest(`responses-${_name}`),
    );

    expect(result).toMatchObject({
      status: "failed",
      partialTranslation: "部分",
      error: { code },
      quality: {
        pasteBlocked: true,
        risks: expect.arrayContaining([
          expect.objectContaining({ code: "stream.incomplete" }),
        ]),
      },
    });
  });

  it("keeps Responses partial text when the shared lifecycle times out", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        request.onData(
          Buffer.from(
            'event: response.created\ndata: {"type":"response.created","response":{"id":"response-timeout"}}\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"部分"}\n\n',
          ),
        );
        throw Object.assign(new Error("timeout"), { code: "timeout" });
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(true),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(translationRequest("responses-timeout")),
    ).resolves.toMatchObject({
      status: "failed",
      partialTranslation: "部分",
      error: { code: "timeout" },
      quality: {
        pasteBlocked: true,
        risks: expect.arrayContaining([
          expect.objectContaining({ code: "stream.incomplete" }),
        ]),
      },
    });
  });

  it("rejects non-text normal output and retains the accepted prefix", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "部分" }],
            },
            { type: "function_call", name: "tool" },
          ],
        }),
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(false),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(
        translationRequest("responses-normal-tool"),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      partialTranslation: "部分",
      error: { code: "protocol_error" },
    });
  });

  it("prefers top-level output_text without inspecting fallback output", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({
          output_text: "你好",
          output: [{ type: "function_call", name: "ignored-fallback" }],
        }),
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(false),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(
        translationRequest("responses-output-text-preferred"),
      ),
    ).resolves.toMatchObject({ status: "completed", translation: "你好" });
  });

  it.each([
    [
      "in_progress without created",
      [
        { type: "response.in_progress", response: { id: "r" } },
        { type: "response.output_text.delta", delta: "x" },
        { type: "response.output_text.done", text: "x" },
        { type: "response.completed", response: { status: "completed" } },
      ],
    ],
    [
      "content part done without added",
      [
        { type: "response.created", response: { id: "r" } },
        { type: "response.output_text.delta", delta: "x" },
        { type: "response.output_text.done", text: "x" },
        {
          type: "response.content_part.done",
          part: { type: "output_text", text: "x" },
        },
        { type: "response.completed", response: { status: "completed" } },
      ],
    ],
    [
      "output item done without added",
      [
        { type: "response.created", response: { id: "r" } },
        { type: "response.output_text.delta", delta: "x" },
        { type: "response.output_text.done", text: "x" },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            content: [{ type: "output_text", text: "x" }],
          },
        },
        { type: "response.completed", response: { status: "completed" } },
      ],
    ],
  ])("rejects invalid event order: %s", async (_name, events) => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        for (const event of events) {
          request.onData(
            Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
        return { status: 200, headers: {}, body: "", complete: true };
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(true),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(
        translationRequest(`responses-invalid-order-${_name}`),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "protocol_error" },
    });
  });

  it("streams multiple ordered text message items", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const events = [
      { type: "response.created", response: { id: "multi" } },
      {
        type: "response.output_item.added",
        item: { type: "message", id: "m1" },
      },
      {
        type: "response.content_part.added",
        part: { type: "output_text", text: "" },
      },
      { type: "response.output_text.delta", delta: "你" },
      { type: "response.output_text.done", text: "你" },
      {
        type: "response.content_part.done",
        part: { type: "output_text", text: "你" },
      },
      {
        type: "response.output_item.done",
        item: {
          type: "message",
          content: [{ type: "output_text", text: "你" }],
        },
      },
      {
        type: "response.output_item.added",
        item: { type: "message", id: "m2" },
      },
      {
        type: "response.content_part.added",
        part: { type: "output_text", text: "" },
      },
      { type: "response.output_text.delta", delta: "好" },
      { type: "response.output_text.done", text: "好" },
      {
        type: "response.content_part.done",
        part: { type: "output_text", text: "好" },
      },
      {
        type: "response.output_item.done",
        item: {
          type: "message",
          content: [{ type: "output_text", text: "好" }],
        },
      },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "你" }],
            },
            {
              type: "message",
              content: [{ type: "output_text", text: "好" }],
            },
          ],
        },
      },
    ];
    const transport = {
      request: vi.fn(async (request) => {
        for (const event of events) {
          request.onData(
            Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
        return { status: 200, headers: {}, body: "", complete: true };
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(true),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(
        translationRequest("responses-multiple-items"),
      ),
    ).resolves.toMatchObject({ status: "completed", translation: "你好" });
  });

  it("rejects an SSE event name without event data", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        request.onData(Buffer.from("event: response.created\n\n"));
        return { status: 200, headers: {}, body: "", complete: true };
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset(true),
    });
    await runtime.saveApiKey(credentialForm(credential));

    await expect(
      runtime.startStandardTranslation(
        translationRequest("responses-event-without-data"),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "protocol_error" },
    });
  });
});
