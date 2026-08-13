const CHUNKING_VERSION = "ruyi-segmentation-v1";
const TARGET_MIN_CODE_POINTS = 1_800;
const TARGET_MAX_CODE_POINTS = 2_500;
const HARD_MAX_CODE_POINTS = 3_000;
const CONTEXT_CODE_POINTS = 500;
const MIN_CONTEXT_REPEAT_CODE_POINTS = 32;

function normalizeSourceText(sourceText) {
  return String(sourceText).replace(/\r\n/gu, "\n");
}

function codePointTable(text) {
  const codePoints = Array.from(text);
  const utf16ToCodePoint = new Uint32Array(text.length + 1);
  let utf16Offset = 0;
  for (let codePointOffset = 0; codePointOffset < codePoints.length; codePointOffset += 1) {
    const width = codePoints[codePointOffset].length;
    for (let index = 0; index < width; index += 1) {
      utf16ToCodePoint[utf16Offset + index] = codePointOffset;
    }
    utf16Offset += width;
    utf16ToCodePoint[utf16Offset] = codePointOffset + 1;
  }
  return { codePoints, utf16ToCodePoint };
}

function textHash(text) {
  let hash = 0x811c9dc5;
  for (const character of text) {
    const value = character.codePointAt(0);
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function lineRanges(codePoints) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < codePoints.length; index += 1) {
    if (codePoints[index] === "\n") {
      ranges.push({ start, end: index + 1, text: codePoints.slice(start, index + 1).join("") });
      start = index + 1;
    }
  }
  if (start < codePoints.length) {
    ranges.push({ start, end: codePoints.length, text: codePoints.slice(start).join("") });
  }
  return ranges;
}

function collectAtomicSpans(text, table) {
  const spans = [];
  const lines = lineRanges(table.codePoints);
  let openFence = null;

  function add(start, end, kind, label) {
    if (end > start) spans.push({ start, end, kind, label });
  }

  for (const line of lines) {
    const lineWithoutBreak = line.text.replace(/\n$/u, "");
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(lineWithoutBreak);
    if (openFence) {
      if (
        fence &&
        fence[1][0] === openFence.marker &&
        fence[1].length >= openFence.length
      ) {
        add(openFence.start, line.end, "code_block", "代码块");
        openFence = null;
      }
      continue;
    }
    if (fence) {
      openFence = {
        start: line.start,
        marker: fence[1][0],
        length: fence[1].length,
      };
      continue;
    }

    const markdownLine =
      /^[ \t]{0,3}(?:#{1,6}[ \t]+|>|(?:[-+*]|\d+[.)])[ \t]+)/u.test(
        lineWithoutBreak,
      ) ||
      /^[ \t]{0,3}(?:=+|-+)[ \t]*$/u.test(lineWithoutBreak);
    if (markdownLine) {
      add(line.start, line.end, "markdown", "Markdown 结构");
    }
  }
  if (openFence) {
    add(openFence.start, table.codePoints.length, "code_block", "代码块");
  }

  let indentedCodeStart = null;
  let indentedCodeEnd = null;
  for (const line of lines) {
    const lineWithoutBreak = line.text.replace(/\n$/u, "");
    if (/^(?: {4}|\t)/u.test(lineWithoutBreak)) {
      if (indentedCodeStart === null) indentedCodeStart = line.start;
      indentedCodeEnd = line.end;
      continue;
    }
    if (lineWithoutBreak.trim().length === 0 && indentedCodeStart !== null) {
      continue;
    }
    if (indentedCodeStart !== null) {
      add(indentedCodeStart, indentedCodeEnd, "code_block", "代码块");
      indentedCodeStart = null;
      indentedCodeEnd = null;
    }
  }
  if (indentedCodeStart !== null) {
    add(indentedCodeStart, indentedCodeEnd, "code_block", "代码块");
  }

  function splitTableCells(value) {
    const trimmed = value.trim().replace(/^\|/u, "").replace(/\|$/u, "");
    const cells = [];
    let cell = "";
    let escaped = false;
    for (const character of trimmed) {
      if (escaped) {
        cell += character;
        escaped = false;
      } else if (character === "\\") {
        cell += character;
        escaped = true;
      } else if (character === "|") {
        cells.push(cell);
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell);
    return cells;
  }

  function tablePipeCount(value) {
    return Math.max(0, splitTableCells(value).length - 1);
  }

  function isTableSeparator(value) {
    const cells = splitTableCells(value);
    return (
      cells.length >= 2 &&
      cells.every((cell) => /^[ \t]*:?-{3,}:?[ \t]*$/u.test(cell))
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index].text.replace(/\n$/u, "");
    if (!isTableSeparator(lineText)) continue;
    if (index > 0) {
      const headerText = lines[index - 1].text.replace(/\n$/u, "");
      if (tablePipeCount(headerText) > 0) {
        add(lines[index - 1].start, lines[index - 1].end, "table_row", "表格行");
      }
    }
    add(lines[index].start, lines[index].end, "table_row", "表格行");
    for (let row = index + 1; row < lines.length; row += 1) {
      const rowText = lines[row].text.replace(/\n$/u, "");
      if (rowText.trim().length === 0 || tablePipeCount(rowText) === 0) break;
      add(lines[row].start, lines[row].end, "table_row", "表格行");
    }
  }

  function collectRegex(pattern, kind, label, trimEnd = null) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let value = match[0];
      if (trimEnd) value = trimEnd(value);
      if (value.length > 0) {
        const start = table.utf16ToCodePoint[match.index];
        const end = start + Array.from(value).length;
        add(start, end, kind, label);
      }
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }

  collectRegex(/(`+)[^`\n]*?\1/gu, "inline_code", "行内代码");
  collectRegex(/!?\[[^\]\n]*\]\((?:\\.|[^)\n])*\)/gu, "markdown_link", "Markdown 链接");
  collectRegex(
    /\b(?:https?|ftp):\/\/[^\s<>"']+/gu,
    "url",
    "URL",
    (value) => value.replace(/[.,;:!?]+$/u, ""),
  );
  collectRegex(/%(?:\d+\$)?[-+#0 ']*(?:\d+|\*)?(?:\.\d+)?[a-zA-Z]/gu, "placeholder", "占位符");

  function collectDelimitedMarkdown(marker) {
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(marker, cursor);
      if (start < 0) return;
      const previous = text[start - 1];
      const next = text[start + marker.length];
      const singleMarkerAdjacent =
        marker.length === 1 &&
        (previous === marker || text[start + 1] === marker);
      const underscoreInsideWord =
        marker.includes("_") && previous && /[\p{L}\p{N}_]/u.test(previous);
      if (
        previous === "\\" ||
        singleMarkerAdjacent ||
        underscoreInsideWord ||
        !next ||
        /\s/u.test(next)
      ) {
        cursor = start + marker.length;
        continue;
      }
      let end = text.indexOf(marker, start + marker.length);
      while (end >= 0) {
        const beforeEnd = text[end - 1];
        const afterEnd = text[end + marker.length];
        const escaped = text[end - 1] === "\\";
        const singleClosingAdjacent =
          marker.length === 1 && text[end + marker.length] === marker;
        const underscoreClosingInsideWord =
          marker.includes("_") && afterEnd && /[\p{L}\p{N}_]/u.test(afterEnd);
        if (
          !escaped &&
          !singleClosingAdjacent &&
          !underscoreClosingInsideWord &&
          beforeEnd &&
          (marker.length > 1 || !/\s/u.test(beforeEnd))
        ) {
          const sourceStart = table.utf16ToCodePoint[start];
          const sourceEnd = table.utf16ToCodePoint[end + marker.length];
          add(sourceStart, sourceEnd, "markdown_inline", "Markdown 行内结构");
          cursor = end + marker.length;
          break;
        }
        end = text.indexOf(marker, end + marker.length);
      }
      if (end < 0) cursor = start + marker.length;
    }
  }

  for (const marker of ["**", "__", "~~", "*", "_"]) {
    collectDelimitedMarkdown(marker);
  }

  const braceStack = [];
  let outerStart = -1;
  for (let index = 0; index < table.codePoints.length; index += 1) {
    const character = table.codePoints[index];
    if (character === "{" && table.codePoints[index - 1] !== "\\") {
      if (braceStack.length === 0) outerStart = index;
      braceStack.push(index);
    } else if (character === "}" && table.codePoints[index - 1] !== "\\" && braceStack.length) {
      braceStack.pop();
      if (braceStack.length === 0) {
        add(outerStart, index + 1, "placeholder", "占位符");
        outerStart = -1;
      }
    }
  }
  if (braceStack.length > 0 && outerStart >= 0) {
    add(outerStart, table.codePoints.length, "placeholder", "占位符");
  }

  spans.sort((left, right) => left.start - right.start || right.end - left.end);
  return spans;
}

function fallbackForOversizedAtomicSpan(spans) {
  const oversized = spans.find((span) => span.end - span.start > HARD_MAX_CODE_POINTS);
  return oversized
    ? `${oversized.label}是不可切分单元，长度超过 3,000 个 Unicode 码点，本次已回退为全文翻译。`
    : null;
}

function createBoundaryRanks(codePoints, spans) {
  const ranks = new Uint8Array(codePoints.length + 1);
  const difference = new Int32Array(codePoints.length + 2);
  for (const span of spans) {
    if (span.end - span.start > 1) {
      difference[span.start + 1] += 1;
      difference[span.end] -= 1;
    }
  }
  let covered = 0;
  for (let position = 1; position < codePoints.length; position += 1) {
    covered += difference[position];
    if (covered > 0) continue;
    ranks[position] = 1;
    const previous = codePoints[position - 1];
    if (/\s/u.test(previous)) ranks[position] = 2;
    if (/[。！？.!?]/u.test(previous)) ranks[position] = 3;
    if (previous === "\n") ranks[position] = 4;
    if (previous === "\n" && codePoints[position - 2] === "\n") ranks[position] = 5;
  }
  ranks[codePoints.length] = 5;
  return ranks;
}

function pick(ranks, start, lower, upper, minimumRank, direction) {
  if (lower > upper) return null;
  if (direction === "forward") {
    for (let position = lower; position <= upper; position += 1) {
      if (ranks[position] >= minimumRank) return position;
    }
  } else {
    for (let position = upper; position >= lower; position -= 1) {
      if (ranks[position] >= minimumRank) return position;
    }
  }
  return null;
}

function chooseBoundary(ranks, start, total) {
  if (total - start <= HARD_MAX_CODE_POINTS) return total;
  const minimum = start + TARGET_MIN_CODE_POINTS;
  const target = start + TARGET_MAX_CODE_POINTS;
  const maximum = Math.min(total, start + HARD_MAX_CODE_POINTS);

  return (
    pick(ranks, start, minimum, target, 4, "backward") ||
    pick(ranks, start, minimum, target, 3, "backward") ||
    pick(ranks, start, target + 1, maximum, 4, "forward") ||
    pick(ranks, start, target + 1, maximum, 3, "forward") ||
    pick(ranks, start, minimum, target, 2, "backward") ||
    pick(ranks, start, minimum, target, 1, "backward") ||
    pick(ranks, start, target + 1, maximum, 2, "forward") ||
    pick(ranks, start, target + 1, maximum, 1, "forward") ||
    pick(ranks, start, start + 1, minimum - 1, 4, "backward") ||
    pick(ranks, start, start + 1, minimum - 1, 1, "backward")
  );
}

function createTranslationPlan(sourceText) {
  const normalizedSourceText = normalizeSourceText(sourceText);
  const table = codePointTable(normalizedSourceText);
  const base = {
    chunkingVersion: CHUNKING_VERSION,
    normalizedSourceText,
  };
  if (table.codePoints.length <= TARGET_MAX_CODE_POINTS) {
    return Object.freeze({ ...base, mode: "full_document", segments: [], fallbackReason: null });
  }

  const spans = collectAtomicSpans(normalizedSourceText, table);
  const oversizedReason = fallbackForOversizedAtomicSpan(spans);
  if (oversizedReason) {
    return Object.freeze({
      ...base,
      mode: "full_document",
      segments: [],
      fallbackReason: oversizedReason,
    });
  }

  const ranks = createBoundaryRanks(table.codePoints, spans);
  const ranges = [];
  let start = 0;
  while (start < table.codePoints.length) {
    const end = chooseBoundary(ranks, start, table.codePoints.length);
    if (!end || end <= start || end - start > HARD_MAX_CODE_POINTS) {
      return Object.freeze({
        ...base,
        mode: "full_document",
        segments: [],
        fallbackReason:
          "存在无法安全切分且超过 3,000 个 Unicode 码点的结构单元，本次已回退为全文翻译。",
      });
    }
    ranges.push({ start, end });
    start = end;
  }
  if (ranges.length < 2) {
    return Object.freeze({ ...base, mode: "full_document", segments: [], fallbackReason: null });
  }

  const hash = textHash(normalizedSourceText);
  const segments = ranges.map((range, ordinal) => {
    const sourceContextBefore = table.codePoints
      .slice(Math.max(0, range.start - CONTEXT_CODE_POINTS), range.start)
      .join("");
    const ownedSource = table.codePoints.slice(range.start, range.end).join("");
    const sourceContextAfter = table.codePoints
      .slice(range.end, Math.min(table.codePoints.length, range.end + CONTEXT_CODE_POINTS))
      .join("");
    return Object.freeze({
      id: `segment-${CHUNKING_VERSION.slice(-2)}-${hash}-${ordinal}-${range.start}-${range.end}`,
      ordinal,
      sourceStart: range.start,
      sourceEnd: range.end,
      sourceContextBefore,
      ownedSource,
      sourceContextAfter,
    });
  });
  return Object.freeze({
    ...base,
    mode: "segmented",
    segments: Object.freeze(segments),
    fallbackReason: null,
  });
}

function segmentRisk(code, message, index) {
  return Object.freeze({
    id: `segment-risk-${index + 1}`,
    code,
    category: "structure",
    severity: "critical",
    certainty: "deterministic",
    message,
  });
}

function repeatedContextRisk(segment, translation) {
  const before = segment.sourceContextBefore;
  const after = segment.sourceContextAfter;
  const owned = segment.ownedSource;

  function suffixPrefixOverlap(left, right) {
    const leftPoints = Array.from(left);
    const rightPoints = Array.from(right);
    const maximum = Math.min(leftPoints.length, rightPoints.length);
    for (let length = maximum; length >= MIN_CONTEXT_REPEAT_CODE_POINTS; length -= 1) {
      const suffix = leftPoints.slice(leftPoints.length - length).join("");
      const prefix = rightPoints.slice(0, length).join("");
      if (suffix === prefix && suffix.trim().length > 0) return suffix;
    }
    return null;
  }

  const repeatedBefore = suffixPrefixOverlap(before, translation);
  if (repeatedBefore && !owned.startsWith(repeatedBefore)) {
    return "译文重复了该分段之前的只读上下文。";
  }
  const repeatedAfter = suffixPrefixOverlap(translation, after);
  if (repeatedAfter && !owned.endsWith(repeatedAfter)) {
    return "译文重复了该分段之后的只读上下文。";
  }
  return null;
}

function mergeSegmentTranslations(segments, results) {
  const expected = new Map(segments.map((segment) => [segment.id, segment]));
  const accepted = new Map();
  const risks = [];
  const seen = new Set();

  for (const result of results) {
    const segment = expected.get(result && result.id);
    if (!segment) {
      risks.push(segmentRisk("segment.unknown", "收到不属于本次任务的分段结果。", risks.length));
      continue;
    }
    if (seen.has(result.id)) {
      risks.push(segmentRisk("segment.duplicate", `分段 ${segment.ordinal + 1} 返回了重复结果。`, risks.length));
      continue;
    }
    seen.add(result.id);
    if (
      result.ordinal !== segment.ordinal ||
      result.sourceStart !== segment.sourceStart ||
      result.sourceEnd !== segment.sourceEnd
    ) {
      risks.push(segmentRisk("segment.metadata_mismatch", `分段 ${segment.ordinal + 1} 的顺序或源范围不匹配。`, risks.length));
      continue;
    }
    if (typeof result.translation !== "string") {
      risks.push(segmentRisk("segment.invalid_result", `分段 ${segment.ordinal + 1} 没有有效文本结果。`, risks.length));
      continue;
    }
    accepted.set(result.id, result.translation);
    const contextMessage = repeatedContextRisk(segment, result.translation);
    if (contextMessage) {
      risks.push(segmentRisk("segment.context_repeated", contextMessage, risks.length));
    }
  }

  for (const segment of segments) {
    if (!accepted.has(segment.id)) {
      risks.push(segmentRisk("segment.missing", `缺少第 ${segment.ordinal + 1} 个分段的结果。`, risks.length));
    }
  }
  const translation = segments
    .filter((segment) => accepted.has(segment.id))
    .map((segment) => accepted.get(segment.id))
    .join("");
  return Object.freeze({
    translation,
    risks: Object.freeze(risks),
    pasteBlocked: risks.length > 0,
  });
}

function parallelConfigurationError() {
  return Object.assign(new Error("并发数必须是 1 至 6 的整数。"), {
    code: "invalid_parallel_configuration",
    field: "parallelConcurrency",
  });
}

async function runSegmentPool({
  segments,
  concurrency = 3,
  signal,
  translate,
  onSegmentStarted = () => undefined,
  onSegmentCompleted = () => undefined,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw parallelConfigurationError();
  }
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (typeof translate !== "function") throw new TypeError("translate must be a function");

  const results = [];
  const partialResults = new Map();
  const controllers = new Set();
  let nextIndex = 0;
  let failure = null;
  let stopped = Boolean(signal && signal.aborted);

  function abortInFlight() {
    stopped = true;
    for (const controller of controllers) controller.abort();
  }
  const abortListener = () => abortInFlight();
  if (signal) signal.addEventListener("abort", abortListener, { once: true });

  async function worker() {
    while (!stopped) {
      const index = nextIndex;
      if (index >= segments.length) return;
      nextIndex += 1;
      const segment = segments[index];
      const controller = new AbortController();
      controllers.add(controller);
      try {
        onSegmentStarted(segment, {
          inFlight: controllers.size,
          completed: results.length,
          total: segments.length,
        });
        const result = await translate(segment, { signal: controller.signal });
        if (stopped || controller.signal.aborted || (signal && signal.aborted)) return;
        results.push(result);
        onSegmentCompleted(result, {
          inFlight: Math.max(0, controllers.size - 1),
          completed: results.length,
          total: segments.length,
        });
      } catch (error) {
        if (error && error.partialSegmentResult) {
          partialResults.set(error.partialSegmentResult.id, error.partialSegmentResult);
        }
        if (!failure) failure = error;
        abortInFlight();
        return;
      } finally {
        controllers.delete(controller);
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, segments.length) }, () => worker()),
    );
  } finally {
    if (signal) signal.removeEventListener("abort", abortListener);
  }
  if ((signal && signal.aborted) || (!failure && stopped)) {
    failure = Object.assign(new Error("翻译已取消。"), { code: "cancelled" });
  }
  if (failure) {
    failure.segmentResults = [...results];
    failure.partialSegmentResults = [...partialResults.values()];
    throw failure;
  }
  return results;
}

function parallelAccelerationAdvice({ sourceCodePoints, performanceSummary }) {
  const sourceLength = Number.isFinite(sourceCodePoints) ? sourceCodePoints : 0;
  if (
    !performanceSummary ||
    !Number.isFinite(performanceSummary.sampleCount) ||
    performanceSummary.sampleCount < 1 ||
    !Number.isFinite(performanceSummary.averageOutputCodePointsPerSecond) ||
    performanceSummary.averageOutputCodePointsPerSecond <= 0
  ) {
    return Object.freeze({
      suggested: sourceLength > 4_000,
      estimatedSeconds: null,
      reason: sourceLength > 4_000 ? "no_samples_long_source" : null,
    });
  }
  const firstOutputMilliseconds = Number.isFinite(
    performanceSummary.averageFirstOutputMilliseconds,
  )
    ? performanceSummary.averageFirstOutputMilliseconds
    : 0;
  const estimatedSeconds = Math.ceil(
    firstOutputMilliseconds / 1_000 +
      sourceLength / performanceSummary.averageOutputCodePointsPerSecond,
  );
  return Object.freeze({
    suggested: estimatedSeconds > 45,
    estimatedSeconds,
    reason: estimatedSeconds > 45 ? "estimated_over_45_seconds" : null,
  });
}

module.exports = {
  CHUNKING_VERSION,
  CONTEXT_CODE_POINTS,
  HARD_MAX_CODE_POINTS,
  TARGET_MAX_CODE_POINTS,
  TARGET_MIN_CODE_POINTS,
  createTranslationPlan,
  mergeSegmentTranslations,
  normalizeSourceText,
  parallelAccelerationAdvice,
  runSegmentPool,
};
