const { StringDecoder } = require("string_decoder");
const { createOutputAccumulator } = require("./text-limits.cjs");

function responsesError(code, message, partialTranslation = "") {
  const error = new Error(message);
  error.code = code;
  error.safeMessage = message;
  error.partialTranslation = partialTranslation;
  return error;
}

function appendText(output, text) {
  if (typeof text !== "string") {
    throw responsesError(
      "protocol_error",
      "Responses 返回了非文本内容。",
      output.text(),
    );
  }
  if (!output.append(text)) {
    throw responsesError(
      "response_too_large",
      "译文超过 100,000 个 Unicode 码点。",
      output.text(),
    );
  }
}

function textFromMessageItems(items, output = createOutputAccumulator()) {
  if (!Array.isArray(items)) {
    throw responsesError(
      "protocol_error",
      "Responses 响应缺少 output 数组。",
      output.text(),
    );
  }
  for (const item of items) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      throw responsesError(
        "protocol_error",
        "Responses 返回了不支持的输出类型。",
        output.text(),
      );
    }
    for (const part of item.content) {
      if (!part || part.type !== "output_text") {
        throw responsesError(
          "protocol_error",
          "Responses 返回了工具或多媒体内容。",
          output.text(),
        );
      }
      appendText(output, part.text);
    }
  }
  return output.text();
}

function validateCompletedResponse(response, expectedText) {
  if (!response || typeof response !== "object") {
    throw responsesError(
      "protocol_error",
      "Responses 完成事件缺少响应对象。",
      expectedText,
    );
  }
  if (response.status && response.status !== "completed") {
    throw responsesError(
      "protocol_error",
      "Responses 完成事件状态无效。",
      expectedText,
    );
  }
  if (response.output !== undefined) {
    const text = textFromMessageItems(response.output);
    if (text !== expectedText) {
      throw responsesError(
        "protocol_error",
        "Responses 完成事件与文本增量不一致。",
        expectedText,
      );
    }
  }
}

function parseResponsesResponse(body) {
  let response;
  try {
    response = JSON.parse(body);
  } catch {
    throw responsesError("protocol_error", "无法解析 Responses JSON。", "");
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw responsesError("protocol_error", "Responses 响应结构无效。", "");
  }
  if (response.error) {
    throw responsesError("server_error", "模型服务返回了错误。", "");
  }
  if (response.status === "failed") {
    throw responsesError("server_error", "模型服务未能完成响应。", "");
  }
  if (response.status === "incomplete") {
    throw responsesError("request_rejected", "模型服务返回了不完整响应。", "");
  }

  const output = createOutputAccumulator();
  if (response.output_text !== undefined && response.output_text !== null) {
    appendText(output, response.output_text);
    return output.text();
  }
  return textFromMessageItems(response.output, output);
}

function createResponsesSseParser({ onTextDelta = () => undefined } = {}) {
  const decoder = new StringDecoder("utf8");
  const output = createOutputAccumulator();
  let textBuffer = "";
  let eventName = null;
  let dataLines = [];
  let ended = false;
  let completed = false;
  let outputStarted = false;
  let activeItem = false;
  let activePart = false;
  let currentPartDone = false;
  let currentPartText = "";
  let currentItemText = "";
  let currentItemHasText = false;
  let sawTextDone = false;
  let responseCreated = false;
  let responseInProgress = false;

  function fail(code, message) {
    throw responsesError(code, message, output.text());
  }

  function validateItem(item) {
    if (!item || item.type !== "message") {
      fail("protocol_error", "Responses 返回了工具或非文本输出项。");
    }
    if (item.content !== undefined) {
      textFromMessageItems([item]);
    }
  }

  function validatePart(part) {
    if (!part || part.type !== "output_text") {
      fail("protocol_error", "Responses 返回了工具或多媒体内容部分。");
    }
    if (part.text !== undefined && typeof part.text !== "string") {
      fail("protocol_error", "Responses 文本内容部分无效。");
    }
  }

  function dispatchEvent() {
    if (dataLines.length === 0) {
      if (eventName !== null) {
        fail("protocol_error", "Responses SSE 事件缺少 data。" );
      }
      eventName = null;
      return;
    }
    if (completed) {
      fail("protocol_error", "Responses 完成后仍有事件。");
    }
    let event;
    try {
      event = JSON.parse(dataLines.join("\n"));
    } catch {
      fail("protocol_error", "无法解析 Responses 流事件 JSON。");
    }
    dataLines = [];
    if (!event || typeof event.type !== "string") {
      fail("protocol_error", "Responses 流事件缺少类型。");
    }
    if (eventName && eventName !== event.type) {
      fail("protocol_error", "Responses SSE 事件名与数据类型不一致。");
    }
    eventName = null;

    switch (event.type) {
      case "response.created":
        if (responseCreated || outputStarted || responseInProgress) {
          fail("protocol_error", "Responses created 事件顺序无效。");
        }
        responseCreated = true;
        return;
      case "response.in_progress":
        if (!responseCreated || responseInProgress || outputStarted) {
          fail("protocol_error", "Responses in_progress 事件顺序无效。");
        }
        responseInProgress = true;
        return;
      case "response.output_item.added":
        if (!responseCreated || activeItem || activePart) {
          fail("protocol_error", "Responses 输出项开始事件顺序无效。");
        }
        validateItem(event.item);
        activeItem = true;
        currentItemText = "";
        currentItemHasText = false;
        outputStarted = true;
        return;
      case "response.content_part.added":
        if (!activeItem || activePart) {
          fail("protocol_error", "Responses 文本部分开始事件顺序无效。");
        }
        validatePart(event.part);
        activePart = true;
        currentPartDone = false;
        currentPartText = "";
        outputStarted = true;
        return;
      case "response.output_text.delta":
        if (!responseCreated || currentPartDone || (activeItem && !activePart)) {
          fail("protocol_error", "Responses 文本结束后仍有增量。");
        }
        outputStarted = true;
        appendText(output, event.delta);
        currentPartText += event.delta;
        currentItemText += event.delta;
        onTextDelta(event.delta);
        return;
      case "response.output_text.done":
        if (!responseCreated || currentPartDone || (activeItem && !activePart)) {
          fail("protocol_error", "Responses 文本结束事件重复。");
        }
        if (event.text !== undefined && event.text !== currentPartText) {
          fail("protocol_error", "Responses 文本结束事件内容不一致。");
        }
        currentPartDone = true;
        sawTextDone = true;
        if (activeItem) {
          currentItemHasText = true;
        }
        outputStarted = true;
        return;
      case "response.content_part.done":
        if (!activePart || !currentPartDone) {
          fail("protocol_error", "Responses 文本部分结束事件顺序无效。");
        }
        validatePart(event.part);
        if (event.part.text !== undefined && event.part.text !== currentPartText) {
          fail("protocol_error", "Responses 文本部分结束内容不一致。");
        }
        activePart = false;
        currentPartDone = false;
        currentPartText = "";
        return;
      case "response.output_item.done":
        if (!activeItem || activePart || !currentItemHasText) {
          fail("protocol_error", "Responses 输出项结束事件顺序无效。");
        }
        validateItem(event.item);
        if (
          event.item.content !== undefined &&
          textFromMessageItems([event.item]) !== currentItemText
        ) {
          fail("protocol_error", "Responses 输出项结束内容不一致。");
        }
        activeItem = false;
        currentPartDone = false;
        currentPartText = "";
        currentItemText = "";
        currentItemHasText = false;
        return;
      case "response.completed":
        if (!responseCreated || !sawTextDone || activeItem || activePart) {
          fail("protocol_error", "Responses 完成事件顺序无效。");
        }
        validateCompletedResponse(event.response, output.text());
        completed = true;
        return;
      case "response.failed":
        fail("server_error", "模型服务未能完成响应。");
        return;
      case "response.incomplete":
        fail("request_rejected", "模型服务返回了不完整响应。");
        return;
      case "error":
        fail("server_error", "模型服务返回了错误事件。");
        return;
      default:
        fail("protocol_error", "Responses 返回了不支持的流事件。");
    }
  }

  function processLine(rawLine) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      dispatchEvent();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      if (eventName !== null) {
        fail("protocol_error", "Responses SSE 事件名重复。");
      }
      eventName = line.slice(6).trimStart();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      return;
    }
    fail("protocol_error", "Responses SSE 包含无法识别的字段。");
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
        fail("protocol_error", "Responses 响应流已经结束。");
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
      dispatchEvent();
      if (!completed) {
        fail("protocol_error", "Responses 流缺少完成事件。");
      }
    },
    translation() {
      return output.text();
    },
  });
}

module.exports = {
  createResponsesSseParser,
  parseResponsesResponse,
};
