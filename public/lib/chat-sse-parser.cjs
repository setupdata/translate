const { StringDecoder } = require("string_decoder");
const { createOutputAccumulator } = require("./text-limits.cjs");

function protocolError(message, partialTranslation) {
  const error = new Error(message);
  error.code = "protocol_error";
  error.partialTranslation = partialTranslation;
  return error;
}

function responseTooLarge(partialTranslation) {
  const error = new Error("译文超过 100,000 个 Unicode 码点。");
  error.code = "response_too_large";
  error.safeMessage = error.message;
  error.partialTranslation = partialTranslation;
  return error;
}

function createChatSseParser({ onTextDelta = () => undefined } = {}) {
  const decoder = new StringDecoder("utf8");
  const output = createOutputAccumulator();
  let textBuffer = "";
  let done = false;
  let ended = false;

  function processLine(rawLine) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "" || line.startsWith(":")) {
      return;
    }
    if (done) {
      throw protocolError("完成标记之后仍有响应数据。", output.text());
    }
    if (!line.startsWith("data:")) {
      throw protocolError("流式响应包含无法识别的字段。", output.text());
    }

    const data = line.slice(5).trimStart();
    if (data === "[DONE]") {
      done = true;
      return;
    }

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw protocolError("无法解析流式响应 JSON。", output.text());
    }
    if (!event || !Array.isArray(event.choices)) {
      throw protocolError("流式响应缺少 choices。", output.text());
    }
    if (event.choices.length === 0) {
      if (event.usage && typeof event.usage === "object") {
        return;
      }
      throw protocolError("流式响应没有文本选择项。", output.text());
    }

    for (const choice of event.choices) {
      if (!choice || !choice.delta || typeof choice.delta !== "object") {
        throw protocolError("流式响应缺少文本增量结构。", output.text());
      }
      const allowedDeltaFields = new Set([
        "content",
        "reasoning_content",
        "role",
      ]);
      if (
        Object.keys(choice.delta).some(
          (field) => !allowedDeltaFields.has(field),
        )
      ) {
        throw protocolError("流式响应包含不支持的非文本内容。", output.text());
      }
      const {
        content,
        reasoning_content: reasoningContent,
        role,
      } = choice.delta;
      if (role !== undefined && role !== null && typeof role !== "string") {
        throw protocolError("流式响应包含无效角色。", output.text());
      }
      if (
        reasoningContent !== undefined &&
        reasoningContent !== null &&
        typeof reasoningContent !== "string"
      ) {
        throw protocolError("流式响应包含非文本推理内容。", output.text());
      }
      if (content === undefined || content === null) {
        continue;
      }
      if (typeof content !== "string") {
        throw protocolError("流式响应包含非文本内容。", output.text());
      }
      if (!output.append(content)) {
        throw responseTooLarge(output.text());
      }
      onTextDelta(content);
    }
  }

  function processAvailableLines() {
    let newlineIndex = textBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = textBuffer.indexOf("\n");
    }
  }

  return Object.freeze({
    push(chunk) {
      if (ended) {
        throw protocolError("响应流已经结束。", output.text());
      }
      textBuffer += decoder.write(chunk);
      processAvailableLines();
    },
    end() {
      if (ended) {
        return;
      }
      ended = true;
      textBuffer += decoder.end();
      if (textBuffer.length > 0) {
        processLine(textBuffer);
        textBuffer = "";
      }
      if (!done) {
        throw protocolError("流式响应没有完成标记。", output.text());
      }
    },
    completed() {
      return done && ended;
    },
    translation() {
      return output.text();
    },
  });
}

module.exports = {
  createChatSseParser,
};
