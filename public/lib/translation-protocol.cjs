const {
  createChatSseParser,
  parseChatCompletionsResponse,
} = require("./chat-sse-parser.cjs");
const { TRANSLATION_SYSTEM_PROMPT } = require("./prompts.cjs");
const {
  createResponsesSseParser,
  parseResponsesResponse,
} = require("./responses-parser.cjs");

function configurationError() {
  const error = new Error("不支持所选服务协议。");
  error.code = "configuration_error";
  return error;
}

function createProtocolOperation({
  configuration,
  input,
  systemPrompt,
  stream = configuration.stream,
  thinkingEnabled = false,
  onTextDelta = () => undefined,
}) {
  let body;
  let createStreamParser;
  let parseNormalResponse;

  if (configuration.protocol === "responses") {
    body = JSON.stringify({
      model: configuration.model,
      instructions: systemPrompt,
      input: JSON.stringify(input),
      stream,
    });
    createStreamParser = createResponsesSseParser;
    parseNormalResponse = parseResponsesResponse;
  } else if (configuration.protocol === "chat-completions") {
    body = JSON.stringify({
      model: configuration.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(input) },
      ],
      stream,
      ...(configuration.type === "deepseek-official"
        ? { thinking: { type: thinkingEnabled ? "enabled" : "disabled" } }
        : {}),
    });
    createStreamParser = createChatSseParser;
    parseNormalResponse = parseChatCompletionsResponse;
  } else {
    throw configurationError();
  }

  const parser = stream
    ? createStreamParser({ onTextDelta })
    : null;

  return Object.freeze({
    body,
    push(chunk) {
      if (parser) {
        parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    },
    finish(responseBody, sawData) {
      if (!parser) {
        const translation = parseNormalResponse(responseBody);
        onTextDelta(translation);
        return translation;
      }
      if (!sawData && responseBody) {
        parser.push(Buffer.from(responseBody));
      }
      parser.end();
      return parser.translation();
    },
    partialTranslation() {
      return parser ? parser.translation() : "";
    },
  });
}

function createTranslationProtocolOperation({
  configuration,
  input,
  thinkingEnabled = false,
  onTextDelta = () => undefined,
}) {
  return createProtocolOperation({
    configuration,
    input,
    systemPrompt: TRANSLATION_SYSTEM_PROMPT,
    thinkingEnabled,
    onTextDelta,
  });
}

module.exports = {
  createProtocolOperation,
  createTranslationProtocolOperation,
};
