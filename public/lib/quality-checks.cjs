const { TRANSLATION_SYSTEM_PROMPT } = require("./prompts.cjs");

const PROTECTED_KINDS = Object.freeze([
  "number",
  "date",
  "unit",
  "url",
  "email",
  "placeholder",
  "inline_code",
  "code_block",
  "path",
]);

const RISK_MESSAGES = Object.freeze({
  number: "数字的数量或原值与源文不一致。",
  date: "日期的数量或原值与源文不一致。",
  unit: "带单位数值的数量或原值与源文不一致。",
  url: "URL 的数量或地址与源文不一致。",
  email: "邮箱地址的数量或原值与源文不一致。",
  placeholder: "占位符的数量、名称或结构与源文不一致。",
  inline_code: "行内代码的数量或内容与源文不一致。",
  code_block: "代码块的数量、围栏或内容与源文不一致。",
  path: "文件路径的数量或内容与源文不一致。",
});

const KNOWN_WRAPPERS = Object.freeze([
  /^翻译如下\s*[:：]/u,
  /^译文\s*[:：]/u,
  /^translation\s*:/iu,
  /^translated text\s*:/iu,
]);

const FIXED_PROMPT_FRAGMENTS = Object.freeze(
  [
    ...TRANSLATION_SYSTEM_PROMPT.split(/\r?\n/u),
    ...TRANSLATION_SYSTEM_PROMPT.split(/\r?\n/u).flatMap((line) =>
      line.split(/(?<=[.!?])\s+/u),
    ),
  ]
    .map((fragment) => fragment.trim().replace(/^\d+\.\s*/u, ""))
    .filter((fragment) => fragment.length >= 24),
);

function codePointLength(text) {
  return Array.from(text).length;
}

function codePointOffset(text, utf16Offset) {
  return codePointLength(text.slice(0, utf16Offset));
}

function overlaps(occupied, start, end) {
  for (let index = start; index < end; index += 1) {
    if (occupied[index] === 1) return true;
  }
  return false;
}

function addToken(tokens, occupied, text, kind, start, end, comparisonValue) {
  if (end <= start || overlaps(occupied, start, end)) {
    return false;
  }
  const raw = text.slice(start, end);
  tokens.push({
    kind,
    raw,
    comparisonValue: comparisonValue === undefined ? raw : comparisonValue,
    start,
    end,
  });
  occupied.fill(1, start, end);
  return true;
}

function readLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index];
    if (character !== "\n" && character !== "\r" && index !== text.length) {
      continue;
    }
    const contentEnd = index;
    let end = index;
    if (character === "\r" && text[index + 1] === "\n") {
      end = index + 2;
      index += 1;
    } else if (character === "\r" || character === "\n") {
      end = index + 1;
    }
    lines.push({ start, contentEnd, end, content: text.slice(start, contentEnd) });
    start = end;
  }
  return lines;
}

function extractCodeBlocks(text, tokens, occupied) {
  const lines = readLines(text);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].content.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u);
    if (!opening) {
      continue;
    }
    const marker = opening[1][0];
    const minimumLength = opening[1].length;
    let closingIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const closing = lines[candidate].content.match(/^ {0,3}(`+|~+)[ \t]*$/u);
      if (
        closing &&
        closing[1][0] === marker &&
        closing[1].length >= minimumLength
      ) {
        closingIndex = candidate;
        break;
      }
    }
    const end =
      closingIndex >= 0
        ? lines[closingIndex].contentEnd
        : text.length;
    const rawBlock = text.slice(lines[index].start, end);
    addToken(
      tokens,
      occupied,
      text,
      "code_block",
      lines[index].start,
      end,
      rawBlock.replace(/\r\n?/gu, "\n"),
    );
    blocks.push({
      start: lines[index].start,
      end,
      marker,
      markerLength: minimumLength,
      info: opening[2].trim(),
      closed: closingIndex >= 0,
    });
    if (closingIndex < 0) {
      break;
    }
    index = closingIndex;
  }
  return blocks;
}

function collectRegex(text, regex, kind, tokens, occupied, selectRange, keyFor) {
  for (const match of text.matchAll(regex)) {
    const range = selectRange ? selectRange(match) : { start: match.index, end: match.index + match[0].length };
    if (!range || range.start < 0 || range.end > text.length) {
      continue;
    }
    const raw = text.slice(range.start, range.end);
    addToken(
      tokens,
      occupied,
      text,
      kind,
      range.start,
      range.end,
      keyFor ? keyFor(raw, match) : raw,
    );
  }
}

function placeholderKey(raw) {
  const inner = raw.slice(1, -1).trim();
  const header = inner.match(/^([A-Za-z_][\w.-]*)\s*,\s*(plural|select|selectordinal)\s*,([\s\S]*)$/u);
  if (!header) {
    return raw;
  }
  const selectors = [];
  const body = header[3];
  let index = 0;
  while (index < body.length) {
    while (/\s/u.test(body[index] || "")) index += 1;
    const selector = body.slice(index).match(/^(=?[\w.-]+)\s*\{/u);
    if (!selector) break;
    const selectorName = selector[1];
    index += selector[0].length;
    let depth = 1;
    const contentStart = index;
    while (index < body.length && depth > 0) {
      if (body[index] === "{") depth += 1;
      if (body[index] === "}") depth -= 1;
      index += 1;
    }
    if (depth !== 0) return raw;
    const content = body.slice(contentStart, index - 1);
    const nestedHeaders = [...content.matchAll(/\{\s*([A-Za-z_][\w.-]*)(?:\s*,\s*(plural|select|selectordinal))?/gu)]
      .map((match) => `${match[1]}:${match[2] || "value"}`)
      .join("|");
    selectors.push(
      `${selectorName}:${content.trim().length > 0 ? "content" : "empty"}:hash=${
        (content.match(/#/gu) || []).length
      }:nested=${nestedHeaders}`,
    );
  }
  return `{${header[1]},${header[2]},${selectors.join(",")}}`;
}

function collectBracePlaceholders(text, tokens, occupied) {
  const matchingBraces = new Map();
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") {
      stack.push(index);
    } else if (text[index] === "}" && stack.length > 0) {
      matchingBraces.set(stack.pop(), index + 1);
    }
  }
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" || overlaps(occupied, start, start + 1)) continue;
    const beginning = text.slice(start + 1).match(/^\s*[A-Za-z_][\w.-]*/u);
    if (!beginning) continue;
    const end = matchingBraces.get(start) || -1;
    if (end > start) {
      addToken(
        tokens,
        occupied,
        text,
        "placeholder",
        start,
        end,
        placeholderKey(text.slice(start, end)),
      );
      start = end - 1;
    }
  }
}

function trimUrl(raw) {
  let value = raw.replace(/[.,;:!?，。；：！？]+$/u, "");
  let openingParentheses = (value.match(/\(/gu) || []).length;
  let closingParentheses = (value.match(/\)/gu) || []).length;
  while (
    value.endsWith(")") &&
    closingParentheses > openingParentheses
  ) {
    value = value.slice(0, -1);
    closingParentheses -= 1;
  }
  return value;
}

function extractInlineLinks(text) {
  const links = [];
  let marker = text.indexOf("](");
  while (marker >= 0) {
    const labelStart = text.lastIndexOf("[", marker);
    if (labelStart < 0 || /[\r\n]/u.test(text.slice(labelStart, marker))) {
      marker = text.indexOf("](", marker + 2);
      continue;
    }
    let cursor = marker + 2;
    while (/\s/u.test(text[cursor] || "")) cursor += 1;
    let destinationStart = cursor;
    let destinationEnd = cursor;
    if (text[cursor] === "<") {
      destinationStart = cursor + 1;
      const closing = text.indexOf(">", destinationStart);
      if (closing < 0) {
        marker = text.indexOf("](", marker + 2);
        continue;
      }
      destinationEnd = closing;
      cursor = closing + 1;
    } else {
      let depth = 0;
      while (cursor < text.length) {
        const character = text[cursor];
        if (character === "\\") {
          cursor += 2;
          continue;
        }
        if (character === "(" ) {
          depth += 1;
        } else if (character === ")") {
          if (depth === 0) break;
          depth -= 1;
        } else if (/\s/u.test(character) && depth === 0) {
          break;
        }
        cursor += 1;
      }
      destinationEnd = cursor;
    }
    while (/\s/u.test(text[cursor] || "")) cursor += 1;
    let hasTitle = false;
    if (text[cursor] === '"' || text[cursor] === "'") {
      const quote = text[cursor];
      const titleEnd = text.indexOf(quote, cursor + 1);
      if (titleEnd >= 0) {
        hasTitle = true;
        cursor = titleEnd + 1;
        while (/\s/u.test(text[cursor] || "")) cursor += 1;
      }
    }
    if (text[cursor] === ")" && destinationEnd > destinationStart) {
      links.push({
        start: labelStart,
        end: cursor + 1,
        destinationStart,
        destinationEnd,
        destination: text.slice(destinationStart, destinationEnd),
        hasTitle,
      });
    }
    marker = text.indexOf("](", marker + 2);
  }
  return links;
}

function collectUrls(text, tokens, occupied) {
  for (const match of text.matchAll(/(?:https?|ftp):\/\/|www\./giu)) {
    let end = match.index + match[0].length;
    while (
      end < text.length &&
      !/[\s<>\[\]{}"']/u.test(text[end])
    ) {
      end += 1;
    }
    const candidate = trimUrl(text.slice(match.index, end));
    addToken(
      tokens,
      occupied,
      text,
      "url",
      match.index,
      match.index + candidate.length,
      candidate,
    );
  }
}

function extractProtectedTokens(text) {
  const tokens = [];
  const occupied = new Uint8Array(text.length);
  const codeBlocks = extractCodeBlocks(text, tokens, occupied);

  collectRegex(
    text,
    /(`+)([^`\r\n]*?)\1/gu,
    "inline_code",
    tokens,
    occupied,
  );

  for (const link of extractInlineLinks(text)) {
    const kind = /^(?:(?:https?|ftp):\/\/|www\.)/iu.test(link.destination)
      ? "url"
      : "path";
    addToken(
      tokens,
      occupied,
      text,
      kind,
      link.destinationStart,
      link.destinationEnd,
      link.destination,
    );
  }

  collectUrls(text, tokens, occupied);
  collectRegex(
    text,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
    "email",
    tokens,
    occupied,
  );
  collectRegex(
    text,
    /%(?:\d+\$)?[-+#0 ']*\d*(?:\.\d+)?[A-Za-z]/gu,
    "placeholder",
    tokens,
    occupied,
  );
  collectBracePlaceholders(text, tokens, occupied);
  collectRegex(
    text,
    /(?:\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]+|(?:^|[\s(])(?:\.\.?\/|\/)(?:[^\s<>]+\/)*[^\s<>]+)/gmu,
    "path",
    tokens,
    occupied,
    (match) => {
      const leading = /^\s/u.test(match[0]) ? 1 : 0;
      return { start: match.index + leading, end: match.index + match[0].length };
    },
  );
  collectRegex(
    text,
    /(?<!\p{Nd})(?:\p{Nd}{4}[-/.]\p{Nd}{1,2}[-/.]\p{Nd}{1,2}|\p{Nd}{1,2}[-/.]\p{Nd}{1,2}[-/.]\p{Nd}{2,4})(?!\p{Nd})/gu,
    "date",
    tokens,
    occupied,
  );
  collectRegex(
    text,
    /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\s+\d{4})\b/giu,
    "date",
    tokens,
    occupied,
  );
  collectRegex(
    text,
    /(?<!\p{Nd})\p{Nd}{2,4}年\p{Nd}{1,2}月\p{Nd}{1,2}日(?!\p{Nd})/gu,
    "date",
    tokens,
    occupied,
  );
  collectRegex(
    text,
    /\b\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+de)?\s+\d{4}\b/giu,
    "date",
    tokens,
    occupied,
  );

  const units = [
    "kWh", "MWh", "GWh", "KiB", "MiB", "GiB", "kPa", "MPa", "GHz",
    "MHz", "kHz", "rpm", "psi", "km", "cm", "mm", "kg", "mg", "mL",
    "MW", "GW", "kW", "Wh", "mA", "ms", "min", "bar", "°C", "°F", "Hz",
    "Pa", "TB", "GB", "MB", "V", "A", "W", "h", "s", "g", "m", "L", "%",
    "kilowatt-hours", "megawatt-hours", "kilowatts", "megawatts", "gigawatts",
    "kilowatt", "megawatt", "gigawatt", "watts", "watt", "volts", "volt",
    "amperes", "ampere", "amps", "amp", "kilograms", "kilogram", "grams", "gram",
    "kilometres", "kilometers", "kilometre", "kilometer", "centimetres", "centimeters",
    "millimetres", "millimeters", "metres", "meters", "seconds", "second", "minutes",
    "minute", "hours", "hour", "hertz", "千瓦时", "兆瓦时", "吉瓦时", "千瓦", "兆瓦",
    "吉瓦", "瓦", "千伏", "伏特", "伏", "毫安", "安培", "安", "千克", "公斤", "毫克",
    "克", "千米", "公里", "厘米", "毫米", "米", "毫秒", "秒", "分钟", "小时",
    "摄氏度", "华氏度", "赫兹", "兆帕", "千帕", "帕", "毫升", "升",
  ].sort((left, right) => right.length - left.length);
  const escapedUnits = units.map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const unitPattern = new RegExp(
    `(?<!\\p{Nd})[-+]?(?:\\p{Nd}{1,3}(?:[,，]\\p{Nd}{3})+|\\p{Nd}+)(?:[.．]\\p{Nd}+)?\\s*(?:${escapedUnits.join("|")})(?![A-Za-z])`,
    "giu",
  );
  collectRegex(text, unitPattern, "unit", tokens, occupied);
  collectRegex(
    text,
    /(?<!\p{Nd})[-+]?(?:\p{Nd}{1,3}(?:[,，]\p{Nd}{3})+|\p{Nd}+)(?:[.．]\p{Nd}+)?(?!\p{Nd})/gu,
    "number",
    tokens,
    occupied,
  );

  tokens.sort((left, right) => left.start - right.start || left.end - right.end);
  return { tokens, codeBlocks };
}

function multiset(tokens, kind) {
  const values = new Map();
  for (const token of tokens) {
    if (token.kind !== kind) continue;
    values.set(token.comparisonValue, (values.get(token.comparisonValue) || 0) + 1);
  }
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function unescapedPipeCount(line) {
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && (index === 0 || line[index - 1] !== "\\")) count += 1;
  }
  return count;
}

function markdownFingerprint(text, codeBlocks) {
  const tokens = [];
  for (const block of codeBlocks) {
    tokens.push(
      `FENCE:${block.marker}:${block.markerLength}:${block.info}:${block.closed ? "closed" : "open"}`,
    );
  }
  const lines = readLines(text);
  let codeBlockIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    while (
      codeBlockIndex < codeBlocks.length &&
      line.start >= codeBlocks[codeBlockIndex].end
    ) {
      codeBlockIndex += 1;
    }
    if (
      codeBlockIndex < codeBlocks.length &&
      line.start >= codeBlocks[codeBlockIndex].start &&
      line.start < codeBlocks[codeBlockIndex].end
    ) {
      continue;
    }
    const quotePrefix = line.content.match(/^\s*((?:>\s*)+)/u);
    const quoteDepth = quotePrefix ? (quotePrefix[1].match(/>/gu) || []).length : 0;
    if (quoteDepth > 0) tokens.push(`QUOTE:${quoteDepth}`);
    const blockContent = quotePrefix
      ? line.content.slice(quotePrefix[0].length)
      : line.content;
    const heading = blockContent.match(/^ {0,3}(#{1,6})(?:\s+|$)/u);
    if (heading) tokens.push(`HEADING:${heading[1].length}`);
    if (
      index > 0 &&
      /^ {0,3}(?:=+|-+)\s*$/u.test(line.content) &&
      lines[index - 1].content.trim()
    ) {
      tokens.push(`SETEXT:${line.content.trim().startsWith("=") ? 1 : 2}`);
    }
    const list = blockContent.match(/^(\s*)([-+*]|\d+[.)])\s+/u);
    if (list) {
      const marker = /^\d/u.test(list[2]) ? `O:${list[2]}` : `U:${list[2]}`;
      tokens.push(`LIST:${list[1].length}:${marker}`);
    }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(blockContent)) {
      tokens.push("THEMATIC_BREAK");
    }
    for (const match of blockContent.matchAll(
      /(\*\*|__|~~)(?=\S)(?:[^\r\n]*?\S)?\1|(?<!\*)\*(?=\S)(?:[^*\r\n]*?\S)?\*(?!\*)|(?<!_)_(?=\S)(?:[^_\r\n]*?\S)?_(?!_)/gu,
    )) {
      const marker = match[0].startsWith("**")
        ? "**"
        : match[0].startsWith("__")
          ? "__"
          : match[0].startsWith("~~")
            ? "~~"
            : match[0][0];
      tokens.push(`EMPHASIS:${marker}`);
    }
    const pipes = unescapedPipeCount(blockContent);
    if (pipes > 0) {
      const tableCells = blockContent
        .trim()
        .replace(/^\||\|$/gu, "")
        .split("|")
        .map((cell) => cell.trim());
      const separator = tableCells.length > 1 && tableCells.every((cell) => /^:?-{3,}:?$/u.test(cell));
      const alignment = separator
        ? tableCells
            .map((cell) => `${cell.startsWith(":") ? "L" : ""}${cell.endsWith(":") ? "R" : ""}` || "N")
            .join(",")
        : "row";
      tokens.push(`TABLE:${pipes}:${separator ? `separator:${alignment}` : "row"}`);
    }

    const referenceDefinition = blockContent.match(
      /^ {0,3}\[([^\]\r\n]+)\]:\s*<?([^\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/u,
    );
    if (referenceDefinition) {
      const hasTitle = /\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/u.test(blockContent);
      tokens.push(
        `REF_DEF:${referenceDefinition[1].trim().toLowerCase()}:${referenceDefinition[2]}:${
          hasTitle ? "title" : "no-title"
        }`,
      );
    }
  }
  for (const link of extractInlineLinks(text)) {
    if (codeBlocks.some((block) => link.start >= block.start && link.start < block.end)) {
      continue;
    }
    tokens.push(`LINK:${link.destination}:${link.hasTitle ? "title" : "no-title"}`);
  }
  for (const match of text.matchAll(/!?\[[^\]\r\n]+\]\[([^\]\r\n]*)\]/gu)) {
    if (codeBlocks.some((block) => match.index >= block.start && match.index < block.end)) {
      continue;
    }
    tokens.push(`REF_LINK:${match[1] ? match[1].trim().toLowerCase() : "collapsed"}`);
  }
  for (const match of text.matchAll(/<((?:(?:https?|ftp):\/\/)[^>\s]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/giu)) {
    if (codeBlocks.some((block) => match.index >= block.start && match.index < block.end)) {
      continue;
    }
    tokens.push(`AUTOLINK:${match[1].includes("@") ? "email" : "url"}`);
  }
  return tokens;
}

function knownWrapper(text) {
  const normalized = text.replace(/^\uFEFF/u, "").trimStart();
  return KNOWN_WRAPPERS.some((pattern) => pattern.test(normalized));
}

function addRisk(risks, risk) {
  risks.push(Object.freeze({
    id: `quality-${risks.length + 1}`,
    ...risk,
  }));
}

function occurrenceCount(text, fragment) {
  let count = 0;
  let index = text.indexOf(fragment);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(fragment, index + fragment.length);
  }
  return count;
}

function inspectTranslationQuality({ sourceText, translation, streamCompleted = true }) {
  const source = extractProtectedTokens(sourceText);
  const target = extractProtectedTokens(translation);
  const risks = [];

  if (translation.trim().length === 0) {
    addRisk(risks, {
      code: "output.empty",
      category: "output_contract",
      severity: "critical",
      certainty: "deterministic",
      message: "模型返回了空译文。",
    });
  }

  for (const kind of PROTECTED_KINDS) {
    if (JSON.stringify(multiset(source.tokens, kind)) !== JSON.stringify(multiset(target.tokens, kind))) {
      addRisk(risks, {
        code: `protected.${kind}.mismatch`,
        category: "protected_content",
        severity: "critical",
        certainty: "deterministic",
        message: RISK_MESSAGES[kind],
      });
    }
  }

  if (
    JSON.stringify(markdownFingerprint(sourceText, source.codeBlocks)) !==
    JSON.stringify(markdownFingerprint(translation, target.codeBlocks))
  ) {
    addRisk(risks, {
      code: "structure.markdown.mismatch",
      category: "structure",
      severity: "critical",
      certainty: "deterministic",
      message: "Markdown 标题、列表、链接、表格或代码围栏结构与源文不一致。",
    });
  }

  if (knownWrapper(translation) && !knownWrapper(sourceText)) {
    addRisk(risks, {
      code: "output.known_wrapper",
      category: "output_contract",
      severity: "critical",
      certainty: "deterministic",
      message: "译文以已知的说明性包装语开头，可能包含了译文之外的内容。",
    });
  }

  if (
    FIXED_PROMPT_FRAGMENTS.some(
      (fragment) =>
        occurrenceCount(translation, fragment) > occurrenceCount(sourceText, fragment),
    )
  ) {
    addRisk(risks, {
      code: "output.prompt_fragment",
      category: "output_contract",
      severity: "critical",
      certainty: "deterministic",
      message: "译文包含固定提示词片段，可能发生了输出契约泄露。",
    });
  }

  if (!streamCompleted) {
    addRisk(risks, {
      code: "stream.incomplete",
      category: "stream",
      severity: "critical",
      certainty: "deterministic",
      message: "模型响应没有按所选协议正常结束，现有译文可能不完整。",
    });
  }

  return Object.freeze({
    risks: Object.freeze(risks),
    pasteBlocked: risks.some(
      (risk) =>
        risk.certainty === "deterministic" && risk.severity === "critical",
    ),
  });
}

function extractProtectedItems(text, segmentId = "document") {
  const { tokens } = extractProtectedTokens(text);
  return tokens.map((token, index) => ({
    id: `protected-${index + 1}`,
    segmentId,
    type: token.kind,
    sourceValue: token.raw,
    sourceRange: {
      start: codePointOffset(text, token.start),
      end: codePointOffset(text, token.end),
    },
  }));
}

module.exports = {
  extractProtectedItems,
  inspectTranslationQuality,
};
