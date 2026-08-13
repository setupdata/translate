const schema = require("./ruyi-translate-v1.schema.json");

function contractError(message, field) {
  return Object.assign(new Error(message), {
    code: "protocol_error",
    ...(field ? { field } : {}),
  });
}

function codePointLength(value) {
  return Array.from(value).length;
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function resolveReference(reference) {
  const prefix = "#/$defs/";
  if (typeof reference !== "string" || !reference.startsWith(prefix)) {
    throw contractError("提示词契约引用无效。");
  }
  const definition = schema.$defs[reference.slice(prefix.length)];
  if (!definition) throw contractError("提示词契约引用不存在。");
  return definition;
}

function schemaFailure(path, message) {
  throw contractError(`字段 ${path || "$"} ${message}`, path || undefined);
}

function validateSchemaNode(node, value, path = "$", quiet = false) {
  try {
    if (node.$ref) return validateSchemaNode(resolveReference(node.$ref), value, path);

    if (Array.isArray(node.oneOf)) {
      const accepted = [];
      for (const candidate of node.oneOf) {
        try {
          accepted.push(validateSchemaNode(candidate, value, path));
        } catch {
          // The complete oneOf is reported below without leaking model content.
        }
      }
      if (accepted.length !== 1) schemaFailure(path, "不符合唯一契约分支。");
      return accepted[0];
    }

    let evaluated = new Set();
    if (Array.isArray(node.allOf)) {
      for (const candidate of node.allOf) {
        const child = validateSchemaNode(candidate, value, path);
        for (const property of child) evaluated.add(property);
      }
    }

    if (node.if) {
      let condition = false;
      try {
        validateSchemaNode(node.if, value, path);
        condition = true;
      } catch {
        condition = false;
      }
      const branch = condition ? node.then : node.else;
      if (branch) {
        const child = validateSchemaNode(branch, value, path);
        for (const property of child) evaluated.add(property);
      }
    }

    if (Object.hasOwn(node, "const") && value !== node.const) {
      schemaFailure(path, `必须等于 ${JSON.stringify(node.const)}。`);
    }
    if (Array.isArray(node.enum) && !node.enum.includes(value)) {
      schemaFailure(path, "不是允许的类型或取值。");
    }
    if (node.type) {
      const actual = valueType(value);
      if (node.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          schemaFailure(path, "类型无效。");
        }
      } else if (actual !== node.type) {
        schemaFailure(path, "类型无效。");
      }
    }

    if (typeof value === "string") {
      const length = codePointLength(value);
      if (Number.isInteger(node.minLength) && length < node.minLength) {
        schemaFailure(path, "长度不足。");
      }
      if (Number.isInteger(node.maxLength) && length > node.maxLength) {
        schemaFailure(path, "长度超限。");
      }
      if (typeof node.pattern === "string" && !new RegExp(node.pattern, "u").test(value)) {
        schemaFailure(path, "格式无效。");
      }
    }
    if (typeof value === "number") {
      if (Number.isFinite(node.minimum) && value < node.minimum) {
        schemaFailure(path, "小于允许的最小值。");
      }
      if (Number.isFinite(node.maximum) && value > node.maximum) {
        schemaFailure(path, "超过允许的最大值。");
      }
    }

    if (Array.isArray(value)) {
      if (Number.isInteger(node.minItems) && value.length < node.minItems) {
        schemaFailure(path, "条目数量不足。");
      }
      if (Number.isInteger(node.maxItems) && value.length > node.maxItems) {
        schemaFailure(path, "条目数量超限。");
      }
      if (node.uniqueItems) {
        const seen = new Set(value.map((item) => JSON.stringify(item)));
        if (seen.size !== value.length) schemaFailure(path, "包含重复条目。");
      }
      if (node.items) {
        value.forEach((item, index) =>
          validateSchemaNode(node.items, item, `${path}[${index}]`),
        );
      }
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const properties = node.properties || {};
      if (Array.isArray(node.required)) {
        for (const property of node.required) {
          if (!Object.hasOwn(value, property)) {
            schemaFailure(path, `缺少必填字段 ${property}。`);
          }
        }
      }
      for (const [property, propertySchema] of Object.entries(properties)) {
        evaluated.add(property);
        if (Object.hasOwn(value, property)) {
          validateSchemaNode(propertySchema, value[property], `${path}.${property}`);
        }
      }
      if (node.additionalProperties === false) {
        const unknown = Object.keys(value).find((property) => !Object.hasOwn(properties, property));
        if (unknown) schemaFailure(`${path}.${unknown}`, "是未知字段。");
      }
      if (node.unevaluatedProperties === false) {
        const unknown = Object.keys(value).find((property) => !evaluated.has(property));
        if (unknown) schemaFailure(`${path}.${unknown}`, "是未知字段。");
      }
    }
    return evaluated;
  } catch (error) {
    if (quiet) return null;
    throw error;
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw contractError(`${label}必须唯一。`);
  }
}

function assertRange(range, length, label) {
  if (
    !range ||
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > length
  ) {
    throw contractError(`${label}范围无效。`);
  }
}

function assertTargetLanguage(targetLanguage) {
  if (!targetLanguage || targetLanguage.kind !== "custom") return;
  const label = targetLanguage.modelLabel;
  if (
    typeof label !== "string" ||
    /[\p{Cc}\p{Cf}]/u.test(label) ||
    /```|~~~/u.test(label) ||
    /\b(?:assistant|developer|follow|ignore|output|return|system|translate)\b|忽略|执行|系统提示|翻译|返回|输出|遵循/iu.test(
      label,
    )
  ) {
    throw contractError("自定义目标语言必须是单行可见文本，不能包含控制字符、围栏或指令。");
  }
}

function assertAnalysisTermCoverage(analysis, task) {
  if (!analysis || analysis.taskId !== task.taskId) {
    throw contractError("分析输出 taskId 不匹配。");
  }
  const expectedTerms = task.matchedTerms.map((term) => term.id).sort();
  const actualTerms = analysis.termApplicability.map((term) => term.termId).sort();
  assertUnique(actualTerms, "术语适用性 termId");
  if (JSON.stringify(actualTerms) !== JSON.stringify(expectedTerms)) {
    throw contractError("termApplicability 必须恰好覆盖每个输入术语。");
  }
}

function assertProtectedItems(protectedItems, segments, sourceText = null) {
  assertUnique(protectedItems.map((item) => item.id), "保护项 ID");
  const segmentMap = segments
    ? new Map(segments.map((segment) => [segment.id, segment]))
    : null;
  const fullLength = sourceText === null ? null : codePointLength(sourceText);
  for (const item of protectedItems) {
    const segment = segmentMap ? segmentMap.get(item.segmentId) : null;
    if (segmentMap && !segment) throw contractError("保护项引用了未知段落。");
    const rangeLimit = fullLength === null
      ? segment
        ? segment.sourceEnd
        : null
      : fullLength;
    if (rangeLimit !== null) assertRange(item.sourceRange, rangeLimit, "保护项");
    if (
      segment &&
      (item.sourceRange.start < segment.sourceStart || item.sourceRange.end > segment.sourceEnd)
    ) {
      throw contractError("保护项范围不属于所引用段落。");
    }
    const segmentText = segment && typeof segment.source === "string"
      ? segment.source
      : segment && typeof segment.ownedSource === "string"
        ? segment.ownedSource
        : null;
    const candidateText = sourceText ?? segmentText;
    if (candidateText !== null) {
      const start = sourceText === null && segment ? item.sourceRange.start - segment.sourceStart : item.sourceRange.start;
      const end = sourceText === null && segment ? item.sourceRange.end - segment.sourceStart : item.sourceRange.end;
      const actual = Array.from(candidateText).slice(start, end).join("");
      if (actual !== item.sourceValue) throw contractError("保护项范围与源文本不一致。");
    }
  }
}

function assertBaseTaskData(value, context = {}) {
  assertTargetLanguage(value.targetLanguage);
  assertUnique(value.matchedTerms.map((term) => term.id), "术语 ID");
  assertUnique(value.referenceTranslations.map((reference) => reference.id), "参考译例 ID");
  if (value.domainProfile === null && value.referenceTranslations.length > 0) {
    throw contractError("未选择行业配置时不能携带参考译例。");
  }
  if (
    value.domainProfile &&
    value.referenceTranslations.some(
      (reference) => reference.domainProfileId !== value.domainProfile.id,
    )
  ) {
    throw contractError("参考译例必须属于当前行业配置。");
  }
  assertProtectedItems(
    value.protectedItems,
    context.segments ?? null,
    context.sourceText ?? null,
  );
}

function validateOrderedSegments(segments, sourceLength = null) {
  assertUnique(segments.map((segment) => segment.id), "段落 ID");
  let previousEnd = 0;
  segments.forEach((segment, index) => {
    if (segment.ordinal !== index) throw contractError("段落 ordinal 必须连续递增。");
    if (
      segment.sourceStart < previousEnd ||
      segment.sourceEnd <= segment.sourceStart ||
      (sourceLength !== null && segment.sourceEnd > sourceLength)
    ) {
      throw contractError("段落源范围无效或互相重叠。");
    }
    previousEnd = segment.sourceEnd;
  });
}

function validateAscendingSegments(segments, sourceField = null) {
  assertUnique(segments.map((segment) => segment.id), "段落 ID");
  let previousOrdinal = -1;
  let previousEnd = -1;
  for (const segment of segments) {
    if (
      segment.ordinal <= previousOrdinal ||
      segment.sourceStart < previousEnd ||
      segment.sourceEnd <= segment.sourceStart
    ) {
      throw contractError("段落必须按 ordinal 升序排列且源范围不能重叠。");
    }
    if (
      sourceField &&
      segment.sourceEnd - segment.sourceStart !== codePointLength(segment[sourceField])
    ) {
      throw contractError("段落源范围与源文本长度不一致。");
    }
    previousOrdinal = segment.ordinal;
    previousEnd = segment.sourceEnd;
  }
}

function validateAnalysisInput(value) {
  const sourceLength = codePointLength(value.sourceText);
  validateOrderedSegments(value.segments, sourceLength);
  assertBaseTaskData(value, { segments: value.segments, sourceText: value.sourceText });
}

function validateAnalysisOutput(value, input) {
  if (!input) throw contractError("缺少分析输入上下文。");
  assertAnalysisTermCoverage(value, input);
  const segments = new Map(input.segments.map((segment) => [segment.id, segment]));
  const sourceLength = codePointLength(input.sourceText);
  for (const ambiguity of value.ambiguities) {
    const segment = segments.get(ambiguity.segmentId);
    if (!segment) throw contractError("分析问题引用了未知段落。");
    assertRange(ambiguity.sourceRange, sourceLength, "分析问题");
    if (
      ambiguity.sourceRange.end <= segment.sourceStart ||
      ambiguity.sourceRange.start >= segment.sourceEnd
    ) {
      throw contractError("分析问题范围未与所引用段落相交。");
    }
  }
  for (const risk of value.risks) {
    if (risk.segmentId !== null && !segments.has(risk.segmentId)) {
      throw contractError("分析风险引用了未知段落。");
    }
  }
}

function validateTranslationInput(value) {
  const segments = value.mode === "segment" ? [value.segment] : null;
  assertBaseTaskData(value, {
    segments,
    sourceText: value.mode === "full_document" ? value.sourceText : null,
  });
  if (value.qualityMode === "precision") {
    if (!value.analysis) {
      throw contractError("精译输入必须带同一任务的有效分析结果。");
    }
    assertAnalysisTermCoverage(value.analysis, value);
  } else if (value.analysis !== null) {
    throw contractError("标准翻译输入不能携带分析结果。");
  }
  if (value.mode === "segment") {
    if (
      value.segment.sourceEnd - value.segment.sourceStart !==
      codePointLength(value.segment.ownedSource)
    ) {
      throw contractError("分段 ownedSource 与源范围不一致。");
    }
  }
}

function validateAccuracyInput(value) {
  validateAscendingSegments(value.segments, "source");
  assertBaseTaskData(value, { segments: value.segments });
  assertAnalysisTermCoverage(value.analysis, value);
  const segments = new Map(value.segments.map((segment) => [segment.id, segment]));
  const sourceLength = Math.max(...value.segments.map((segment) => segment.sourceEnd));
  for (const ambiguity of value.analysis.ambiguities) {
    const segment = segments.get(ambiguity.segmentId);
    if (!segment) throw contractError("分析问题引用了未知审校段落。");
    assertRange(ambiguity.sourceRange, sourceLength, "分析问题");
    if (
      ambiguity.sourceRange.end <= segment.sourceStart ||
      ambiguity.sourceRange.start >= segment.sourceEnd
    ) {
      throw contractError("分析问题范围未与审校段落相交。");
    }
  }
}

function validateAccuracyOutput(value, input) {
  if (!input || value.taskId !== input.taskId) throw contractError("准确性审校 taskId 不匹配。");
  assertUnique(value.issues.map((issue) => issue.id), "准确性问题 ID");
  const segments = new Map(input.segments.map((segment) => [segment.id, segment]));
  for (const issue of value.issues) {
    const segment = segments.get(issue.segmentId);
    if (!segment) throw contractError("准确性问题引用了未知段落。");
    if (issue.sourceRange) {
      assertRange(issue.sourceRange, codePointLength(segment.source), "准确性源文");
    }
    if (issue.translationRange) {
      assertRange(
        issue.translationRange,
        codePointLength(segment.translation),
        "准确性译文",
      );
    }
    if (issue.type === "omission" && (!issue.sourceRange || issue.translationRange)) {
      throw contractError("漏译问题的范围组合无效。");
    }
    if (issue.type === "addition" && (issue.sourceRange || !issue.translationRange)) {
      throw contractError("多译问题的范围组合无效。");
    }
    if (!issue.sourceRange && !issue.translationRange) {
      throw contractError("准确性问题至少需要一个证据范围。");
    }
  }
}

function validateLanguageInput(value) {
  assertTargetLanguage(value.targetLanguage);
  assertUnique(value.matchedTerms.map((term) => term.id), "术语 ID");
  assertUnique(value.targetExamples.map((example) => example.id), "目标译例 ID");
  validateAscendingSegments(value.translations);
}

function validateLanguageOutput(value, input) {
  if (!input || value.taskId !== input.taskId) throw contractError("语言审校 taskId 不匹配。");
  assertUnique(value.issues.map((issue) => issue.id), "语言问题 ID");
  const segments = new Map(input.translations.map((segment) => [segment.id, segment]));
  const termIds = new Set(input.matchedTerms.map((term) => term.id));
  for (const issue of value.issues) {
    const segment = segments.get(issue.segmentId);
    if (!segment) throw contractError("语言问题引用了未知段落。");
    assertRange(issue.translationRange, codePointLength(segment.translation), "语言审校译文");
    if (issue.type === "terminology_form") {
      if (issue.termId !== null && !termIds.has(issue.termId)) {
        throw contractError("语言问题引用了未知术语。");
      }
    } else if (issue.termId !== null) {
      throw contractError("非术语词形问题不能携带 termId。");
    }
  }
}

function validateRevisionInput(value) {
  validateAscendingSegments(value.segments, "source");
  assertBaseTaskData(value, { segments: value.segments });
  assertAnalysisTermCoverage(value.analysis, value);
  assertUnique(value.issues.map((issue) => issue.id), "修订问题 ID");
  const segments = new Map(value.segments.map((segment) => [segment.id, segment]));
  const termIds = new Set(value.matchedTerms.map((term) => term.id));
  for (const issue of value.issues) {
    const segment = segments.get(issue.segmentId);
    if (!segment) throw contractError("修订问题引用了未知段落。");
    if (issue.reviewRole === "accuracy") {
      if (issue.termId !== null) throw contractError("准确性问题的 termId 必须为 null。");
      if (issue.sourceRange) {
        assertRange(issue.sourceRange, codePointLength(segment.source), "修订问题源文");
      }
      if (issue.translationRange) {
        assertRange(
          issue.translationRange,
          codePointLength(segment.currentTranslation),
          "修订问题译文",
        );
      }
      if (issue.type === "omission" && (!issue.sourceRange || issue.translationRange)) {
        throw contractError("漏译问题的范围组合无效。");
      }
      if (issue.type === "addition" && (issue.sourceRange || !issue.translationRange)) {
        throw contractError("多译问题的范围组合无效。");
      }
      if (!issue.sourceRange && !issue.translationRange) {
        throw contractError("准确性问题至少需要一个证据范围。");
      }
    } else {
      if (issue.sourceRange !== null) throw contractError("语言问题不能携带源文范围。");
      assertRange(
        issue.translationRange,
        codePointLength(segment.currentTranslation),
        "语言问题译文",
      );
      if (issue.type === "terminology_form") {
        if (issue.termId !== null && !termIds.has(issue.termId)) {
          throw contractError("语言问题引用了未知术语。");
        }
      } else if (issue.termId !== null) {
        throw contractError("非术语词形问题不能携带 termId。");
      }
    }
  }
}

function validateRevisionOutput(value, input) {
  if (!input || value.taskId !== input.taskId) throw contractError("修订输出 taskId 不匹配。");
  assertUnique(value.revisions.map((revision) => revision.segmentId), "修订段落 ID");
  const segments = new Map(input.segments.map((segment) => [segment.id, segment]));
  const issues = new Map(input.issues.map((issue) => [issue.id, issue]));
  const resolved = [];
  for (const revision of value.revisions) {
    const segment = segments.get(revision.segmentId);
    if (!segment) throw contractError("修订输出引用了未知段落。");
    if (
      revision.resolvedIssueIds.length > 0 &&
      revision.replacement === segment.currentTranslation
    ) {
      throw contractError("修订 replacement 必须产生实际变化，不能虚报问题已解决。");
    }
    for (const issueId of revision.resolvedIssueIds) {
      const issue = issues.get(issueId);
      if (!issue || issue.segmentId !== revision.segmentId) {
        throw contractError("修订输出引用了未知问题或错误段落。");
      }
      resolved.push(issueId);
    }
    if (revision.replacement.length === 0) {
      const segmentIssues = input.issues.filter((issue) => issue.segmentId === revision.segmentId);
      const deletionAllowed =
        segment.source.trim().length === 0 &&
        segmentIssues.some((issue) => issue.type === "addition") &&
        !input.protectedItems.some((item) => item.segmentId === revision.segmentId);
      if (!deletionAllowed) throw contractError("当前问题不允许空 replacement。");
    }
  }
  const unresolved = [...value.unresolvedIssueIds];
  assertUnique(resolved, "已解决问题 ID");
  const resolvedSet = new Set(resolved);
  if (unresolved.some((id) => resolvedSet.has(id))) {
    throw contractError("已解决与未解决问题必须互斥。");
  }
  const actual = [...resolved, ...unresolved].sort();
  const expected = [...issues.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw contractError("修订结果必须完整覆盖输入问题集合。");
  }
}

const crossValidators = {
  analysisInput: (value) => validateAnalysisInput(value),
  analysisOutput: (value, context) => validateAnalysisOutput(value, context.input),
  translationInput: (value) => validateTranslationInput(value),
  accuracyReviewInput: (value) => validateAccuracyInput(value),
  accuracyReviewOutput: (value, context) =>
    validateAccuracyOutput(value, context.input),
  languageReviewInput: (value) => validateLanguageInput(value),
  languageReviewOutput: (value, context) =>
    validateLanguageOutput(value, context.input),
  revisionInput: (value) => validateRevisionInput(value),
  revisionOutput: (value, context) => validateRevisionOutput(value, context.input),
};

function validatePromptContract(definitionName, value, context = {}) {
  const definition = schema.$defs[definitionName];
  if (!definition) throw contractError("未知提示词契约。");
  validateSchemaNode(definition, value);
  const crossValidate = crossValidators[definitionName];
  if (crossValidate) crossValidate(value, context);
  return value;
}

function parseStructuredOutput(text, definitionName, context = {}) {
  if (typeof text !== "string") throw contractError("结构化响应必须是文本。");
  let jsonText = text;
  const fence = /^```(?:json)?\r?\n([\s\S]*)\r?\n```$/u.exec(text);
  if (fence) jsonText = fence[1];
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch {
    throw contractError("结构化响应必须是单个 JSON 对象。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError("结构化响应必须是单个 JSON 对象。");
  }
  return validatePromptContract(definitionName, value, context);
}

module.exports = {
  parseStructuredOutput,
  validatePromptContract,
};
