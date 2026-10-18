export interface TextPreview {
  opening: string;
  omittedCharacters: number;
  closing: string;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*+] |\d+\. )/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function openingEnd(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const candidate = text.slice(0, Math.max(0, limit));
  const sentence = [...candidate].reduce((last, char, index) =>
    /[。！？.!?]/.test(char) ? index + 1 : last, 0);
  if (sentence > 0) return sentence;
  const whitespace = candidate.lastIndexOf(" ");
  return whitespace > 0 ? whitespace : limit;
}

function closingStart(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const minimum = Math.max(0, text.length - limit);
  if (minimum > 0 && /[。！？.!?]/.test(text[minimum - 1])) return minimum;
  for (let index = minimum; index < text.length - 1; index += 1) {
    if (/[。！？.!?]/.test(text[index])) return index + 1;
  }
  const whitespace = text.indexOf(" ", minimum);
  return whitespace >= 0 && whitespace < text.length - 1 ? whitespace + 1 : minimum;
}

export function createTextPreview(
  markdown: string,
  openingLimit = 650,
  closingLimit = 320,
): TextPreview {
  const text = markdownToPlainText(markdown);
  if (text.length <= openingLimit + closingLimit) {
    return { opening: text, omittedCharacters: 0, closing: "" };
  }

  const opening = text.slice(0, openingEnd(text, openingLimit)).trimEnd();
  const start = closingStart(text, closingLimit);
  const closing = text.slice(start).trimStart();
  const omittedCharacters = text.slice(opening.length, start).replace(/\s/g, "").length;
  return { opening, omittedCharacters, closing };
}
