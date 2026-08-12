const { validateTermEntry } = require("./terminology.cjs");

const FIELDS = Object.freeze([
  "sourceTerm",
  "preferredTarget",
  "sourceLanguage",
  "targetLanguage",
  "allowedVariants",
  "forbiddenTargets",
  "meaning",
  "strictness",
  "caseSensitive",
  "aliases",
  "priority",
]);
const REQUIRED_FIELDS = Object.freeze([
  "sourceTerm",
  "preferredTarget",
  "sourceLanguage",
  "targetLanguage",
]);
const FORMULA_PREFIX = /^[\t ]*[=+\-@]/u;
const NORMALIZED_HYPHEN = /[\u2010-\u2015\u2212\uFE63\uFF0D]/gu;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_RECORDS = 20_000;
const MAX_CSV_COLUMNS = 100;
const SENSITIVE_COLUMNS = new Set([
  "apikey",
  "authorization",
  "headers",
  "sourcetext",
  "translation",
  "currenttranslation",
]);

function issue(code, message, row = 1, field = null) {
  return Object.freeze({ code, severity: "error", row, ...(field ? { field } : {}), message });
}

function decodeUtf8(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (!ArrayBuffer.isView(bytes)) throw new Error("CSV 必须以 UTF-8 字节提供。");
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(view);
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let recordLine = 1;
  let physicalLine = 1;

  function finishField() {
    row.push(field);
    field = "";
    quoted = false;
    afterQuote = false;
  }
  function finishRecord() {
    finishField();
    records.push({ cells: row, line: recordLine });
    row = [];
    recordLine = physicalLine + 1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
        if (character === "\n") physicalLine += 1;
      }
      continue;
    }
    if (afterQuote) {
      if (character === ",") {
        finishField();
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        finishRecord();
        physicalLine += 1;
      } else {
        throw new Error("CSV 引号字段结束后只能出现分隔符或换行。");
      }
      continue;
    }
    if (character === '"') {
      if (field.length > 0) throw new Error("CSV 字段中的引号必须转义。");
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRecord();
      physicalLine += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV 引号字段没有闭合。");
  if (afterQuote || field.length > 0 || row.length > 0) finishRecord();
  return records;
}

function fieldMapping(headers, requested = {}) {
  const mapping = {};
  const headerSet = new Set(headers);
  for (const field of FIELDS) {
    const selected = Object.prototype.hasOwnProperty.call(requested, field)
      ? requested[field]
      : field;
    mapping[field] = headerSet.has(selected) ? selected : null;
  }
  return Object.freeze(mapping);
}

function restoreSpreadsheetText(value) {
  if (value.startsWith("''")) return value.slice(1);
  if (value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1))) return value.slice(1);
  return value;
}

function listValue(value, field) {
  const restored = restoreSpreadsheetText(value);
  if (restored.trim() === "") return [];
  if (restored.trimStart().startsWith("[")) {
    const parsed = JSON.parse(restored);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error(`${field} 必须是字符串数组。`);
    }
    return parsed;
  }
  return restored.split(/\r?\n/u);
}

function cell(record, headers, mapping, field) {
  const column = mapping[field];
  if (!column) return "";
  const index = headers.indexOf(column);
  return restoreSpreadsheetText(record.cells[index] ?? "");
}

function entryKey(entry) {
  const source = entry.sourceTerm
    .normalize("NFC")
    .replace(NORMALIZED_HYPHEN, "-");
  return JSON.stringify([
    entry.sourceLanguage.toLocaleLowerCase("und"),
    entry.targetLanguage.toLocaleLowerCase("und"),
    entry.caseSensitive ? source : source.toLocaleLowerCase("und"),
    entry.caseSensitive,
  ]);
}

function previewTermbaseCsv({
  bytes,
  mapping: requestedMapping = {},
  existingEntries = [],
  entryIdFactory = () => `csv-${Math.random().toString(36).slice(2)}`,
}) {
  const byteLength =
    bytes instanceof ArrayBuffer
      ? bytes.byteLength
      : ArrayBuffer.isView(bytes)
        ? bytes.byteLength
        : 0;
  if (byteLength > MAX_CSV_BYTES) {
    return Object.freeze({
      columns: [],
      fieldMapping: Object.freeze({}),
      entries: Object.freeze([]),
      issues: Object.freeze([
        issue("fatal_format", "CSV 文件不能超过 5 MiB；请拆分后重新导入。"),
      ]),
      canImport: false,
    });
  }
  let records;
  try {
    records = parseCsv(decodeUtf8(bytes));
  } catch {
    return Object.freeze({
      columns: [],
      fieldMapping: Object.freeze({}),
      entries: Object.freeze([]),
      issues: Object.freeze([
        issue("fatal_format", "CSV 不是有效的 UTF-8 文件，或引号与换行格式无效。"),
      ]),
      canImport: false,
    });
  }
  if (records.length === 0) {
    return Object.freeze({
      columns: [],
      fieldMapping: Object.freeze({}),
      entries: Object.freeze([]),
      issues: Object.freeze([issue("fatal_format", "CSV 文件为空。")]),
      canImport: false,
    });
  }
  if (records.length - 1 > MAX_CSV_RECORDS || records[0].cells.length > MAX_CSV_COLUMNS) {
    return Object.freeze({
      columns: Object.freeze([...records[0].cells]),
      fieldMapping: Object.freeze({}),
      entries: Object.freeze([]),
      issues: Object.freeze([
        issue(
          "fatal_format",
          `CSV 最多包含 ${MAX_CSV_RECORDS.toLocaleString("en-US")} 条记录和 ${MAX_CSV_COLUMNS} 列；请拆分后重新导入。`,
        ),
      ]),
      canImport: false,
    });
  }
  const columns = records[0].cells;
  const mapping = fieldMapping(columns, requestedMapping);
  const issues = [];
  if (new Set(columns).size !== columns.length) {
    issues.push(issue("mapping", "CSV 表头不能重复。"));
  }
  for (const column of columns) {
    if (SENSITIVE_COLUMNS.has(column.trim().toLocaleLowerCase("und"))) {
      issues.push(
        issue(
          "mapping",
          `CSV 不得包含敏感字段“${column}”。`,
          1,
          column,
        ),
      );
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (!mapping[field]) {
      issues.push(issue("mapping", `缺少必填字段映射：${field}。`, 1, field));
    }
  }
  const mappedColumns = new Map();
  for (const field of FIELDS) {
    const column = mapping[field];
    if (!column) continue;
    const priorField = mappedColumns.get(column);
    if (priorField) {
      issues.push(
        issue(
          "mapping",
          `CSV 列“${column}”不能同时映射到 ${priorField} 和 ${field}。`,
          1,
          field,
        ),
      );
    } else {
      mappedColumns.set(column, field);
    }
  }
  const entries = [];
  for (const record of records.slice(1)) {
    if (record.cells.length === 1 && record.cells[0] === "") continue;
    try {
      const strictness = cell(record, columns, mapping, "strictness") || "preferred";
      const caseText = cell(record, columns, mapping, "caseSensitive") || "false";
      if (caseText !== "true" && caseText !== "false") {
        throw new Error("caseSensitive 只能是 true 或 false。");
      }
      const priorityText = cell(record, columns, mapping, "priority") || "0";
      if (!/^-?\d+$/u.test(priorityText) || !Number.isSafeInteger(Number(priorityText))) {
        throw new Error("priority 必须是安全整数。");
      }
      const entry = validateTermEntry(
        {
          id: null,
          sourceTerm: cell(record, columns, mapping, "sourceTerm"),
          preferredTarget: cell(record, columns, mapping, "preferredTarget"),
          sourceLanguage: cell(record, columns, mapping, "sourceLanguage"),
          targetLanguage: cell(record, columns, mapping, "targetLanguage"),
          allowedVariants: listValue(
            cell(record, columns, mapping, "allowedVariants"),
            "allowedVariants",
          ),
          forbiddenTargets: listValue(
            cell(record, columns, mapping, "forbiddenTargets"),
            "forbiddenTargets",
          ),
          meaning: cell(record, columns, mapping, "meaning") || null,
          strictness,
          caseSensitive: caseText === "true",
          aliases: listValue(cell(record, columns, mapping, "aliases"), "aliases"),
          priority: Number(priorityText),
        },
        { entryIdFactory },
      );
      entries.push({ entry, row: record.line });
      if (
        entry.sourceLanguage.toLocaleLowerCase("und") ===
        entry.targetLanguage.toLocaleLowerCase("und")
      ) {
        issues.push(
          issue(
            "language_direction",
            "源语言与目标语言不能相同。",
            record.line,
            "targetLanguage",
          ),
        );
      }
    } catch (error) {
      issues.push(
        issue(
          "invalid_row",
          error instanceof Error ? error.message : "术语行无效。",
          record.line,
        ),
      );
    }
  }

  const seen = new Map(existingEntries.map((entry) => [entryKey(entry), { entry, row: 0 }]));
  for (const candidate of entries) {
    const key = entryKey(candidate.entry);
    const prior = seen.get(key);
    if (prior) {
      const duplicate =
        prior.entry.preferredTarget === candidate.entry.preferredTarget &&
        prior.entry.strictness === candidate.entry.strictness;
      issues.push(
        issue(
          duplicate ? "duplicate" : "conflict",
          duplicate ? "术语与已有条目重复。" : "同一语言方向和源术语存在不同译法。",
          candidate.row,
          "sourceTerm",
        ),
      );
    } else {
      seen.set(key, candidate);
    }
  }
  return Object.freeze({
    columns: Object.freeze([...columns]),
    fieldMapping: mapping,
    entries: Object.freeze(entries.map(({ entry }) => entry)),
    issues: Object.freeze(issues),
    canImport: issues.length === 0,
  });
}

function protectSpreadsheetText(value) {
  if (value.startsWith("'")) return `'${value}`;
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function csvCell(value) {
  const protectedValue = protectSpreadsheetText(String(value));
  return /[",\r\n]/u.test(protectedValue)
    ? `"${protectedValue.replace(/"/gu, '""')}"`
    : protectedValue;
}

function exportTermbaseCsv(termbase) {
  const lines = [FIELDS.join(",")];
  for (const entry of termbase.entries || []) {
    lines.push(
      [
        entry.sourceTerm,
        entry.preferredTarget,
        entry.sourceLanguage,
        entry.targetLanguage,
        JSON.stringify(entry.allowedVariants || []),
        JSON.stringify(entry.forbiddenTargets || []),
        entry.meaning || "",
        entry.strictness,
        String(Boolean(entry.caseSensitive)),
        JSON.stringify(entry.aliases || []),
        String(entry.priority),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const safeName = String(termbase.name || "术语库")
    .replace(/[<>:"/\\|?*]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Object.freeze({
    fileName: `${safeName || "术语库"}.csv`,
    bytes: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`),
  });
}

module.exports = {
  exportTermbaseCsv,
  previewTermbaseCsv,
};
