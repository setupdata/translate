import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const parserPath = resolve(
  import.meta.dirname,
  "../../public/lib/chat-sse-parser.cjs",
);

describe("Chat Completions SSE parser", () => {
  it("parses a normal text response and rejects tool output", () => {
    const { parseChatCompletionsResponse } = require(parserPath);

    expect(
      parseChatCompletionsResponse(
        JSON.stringify({ choices: [{ message: { content: "你好" } }] }),
      ),
    ).toBe("你好");
    expect(() =>
      parseChatCompletionsResponse(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "你好",
                tool_calls: [{ id: "call-1" }],
              },
            },
          ],
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "protocol_error" }));
  });

  it("handles arbitrary UTF-8 chunk boundaries and emits only content deltas", () => {
    const { createChatSseParser } = require(parserPath);
    const onTextDelta = vi.fn();
    const parser = createChatSseParser({ onTextDelta });
    const payload =
      ': keep-alive\r\n\r\ndata: {"choices":[{"delta":{"reasoning_content":"隐藏","content":"😀"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    const bytes = Buffer.from(payload, "utf8");
    const emojiByte = bytes.indexOf(Buffer.from("😀", "utf8"));

    parser.push(bytes.subarray(0, emojiByte + 1));
    parser.push(bytes.subarray(emojiByte + 1, emojiByte + 3));
    parser.push(bytes.subarray(emojiByte + 3));
    parser.end();

    expect(onTextDelta.mock.calls).toEqual([["😀"], ["你好"]]);
    expect(parser.translation()).toBe("😀你好");
    expect(parser.completed()).toBe(true);
  });

  it("allows a usage chunk with no choices before DONE", () => {
    const { createChatSseParser } = require(parserPath);
    const parser = createChatSseParser();

    parser.push(
      Buffer.from(
        'data: {"choices":[],"usage":{"total_tokens":2}}\n\ndata: [DONE]\n\n',
      ),
    );
    parser.end();

    expect(parser.completed()).toBe(true);
    expect(parser.translation()).toBe("");
  });

  it.each([
    ["missing DONE", 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n'],
    [
      "data after DONE",
      'data: [DONE]\n\ndata: {"choices":[{"delta":{"content":"x"}}]}\n\n',
    ],
    ["non-text content", 'data: {"choices":[{"delta":{"content":42}}]}\n\ndata: [DONE]\n\n'],
    [
      "tool call content",
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1"}]}}]}\n\ndata: [DONE]\n\n',
    ],
    ["unknown field", "event: message\n\ndata: [DONE]\n\n"],
  ])("reports a protocol error for %s", (_name, payload) => {
    const { createChatSseParser } = require(parserPath);
    const parser = createChatSseParser();

    expect(() => {
      parser.push(Buffer.from(payload));
      parser.end();
    }).toThrow(expect.objectContaining({ code: "protocol_error" }));
  });

  it("keeps the accepted prefix when output exceeds 100,000 code points", () => {
    const { createChatSseParser } = require(parserPath);
    const parser = createChatSseParser();
    const first = "😀".repeat(100_000);

    parser.push(
      Buffer.from(
        `data: ${JSON.stringify({ choices: [{ delta: { content: first } }] })}\n\n`,
      ),
    );
    expect(() =>
      parser.push(
        Buffer.from('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'),
      ),
    ).toThrow(expect.objectContaining({
      code: "response_too_large",
      partialTranslation: first,
    }));
  });
});
