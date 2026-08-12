const SOURCE_CODE_POINT_LIMIT = 10_000;
const OUTPUT_CODE_POINT_LIMIT = 100_000;

function countCodePoints(text) {
  return Array.from(text).length;
}

function inspectSourceText(text) {
  const normalizedForCounting = text.replace(/\r\n/gu, "\n");
  const normalizedCodePointCount = countCodePoints(normalizedForCounting);
  return {
    originalText: text,
    normalizedCodePointCount,
    valid: normalizedCodePointCount <= SOURCE_CODE_POINT_LIMIT,
  };
}

function createOutputAccumulator(limit = OUTPUT_CODE_POINT_LIMIT) {
  let value = "";
  let length = 0;

  return Object.freeze({
    append(delta) {
      const codePoints = Array.from(delta);
      const remaining = limit - length;
      if (codePoints.length > remaining) {
        if (remaining > 0) {
          value += codePoints.slice(0, remaining).join("");
          length += remaining;
        }
        return false;
      }
      value += delta;
      length += codePoints.length;
      return true;
    },
    text() {
      return value;
    },
    codePointCount() {
      return length;
    },
  });
}

module.exports = {
  OUTPUT_CODE_POINT_LIMIT,
  SOURCE_CODE_POINT_LIMIT,
  countCodePoints,
  createOutputAccumulator,
  inspectSourceText,
};
