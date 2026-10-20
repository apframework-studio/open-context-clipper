import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { sha256Hex } from "../shared/hash";
import type { ExtractedCapture } from "../shared/models";
import { prepareArticleClone } from "./dom-normalizer";
import { extractMetadata } from "./metadata";

const MINIMUM_READABLE_CHARACTERS = 200;

function readableLength(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}

function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const nonCjkWords = text
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + nonCjkWords;
}

function excerpt(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function remoteImageUrls(html: string, baseUrl: string, sourceDocument: Document): string[] {
  const parsed = sourceDocument.implementation.createHTMLDocument("");
  parsed.body.innerHTML = html;
  const urls = [...parsed.images].flatMap((image) => {
    try {
      const url = new URL(image.getAttribute("src") ?? "", baseUrl);
      return url.protocol === "http:" || url.protocol === "https:" ? [url.toString()] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)];
}

function keepRemoteImages(html: string, baseUrl: string, sourceDocument: Document): string {
  const parsed = sourceDocument.implementation.createHTMLDocument("");
  parsed.body.innerHTML = html;
  for (const image of [...parsed.images]) {
    const src = image.getAttribute("src")?.trim();
    if (!src) {
      image.remove();
      continue;
    }
    try {
      const url = new URL(src, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        image.remove();
      } else {
        image.src = url.toString();
      }
    } catch {
      image.remove();
    }
  }
  return parsed.body.innerHTML;
}

function markdownFrom(html: string): string {
  const service = new TurndownService({ codeBlockStyle: "fenced", emDelimiter: "_" });
  service.use(gfm);
  service.addRule("languageFencedCodeBlock", {
    filter: (node) => node.nodeName === "PRE" && node.firstElementChild?.nodeName === "CODE",
    replacement: (_content, node, options) => {
      const className = node.firstElementChild?.getAttribute("class") ?? "";
      const language = className.match(/(?:language|lang)-([\w+-]+)/i)?.[1] ?? "";
      return `\n\n${options.fence}${language}\n${node.textContent ?? ""}\n${options.fence}\n\n`;
    }
  });
  return service.turndown(html).trim();
}

export async function extractCaptureFromDocument(
  document: Document,
  originalUrl: string,
  capturedAt = new Date().toISOString()
): Promise<ExtractedCapture> {
  const clone = prepareArticleClone(document);
  const parsed = new Readability(clone, { keepClasses: true }).parse();
  const readableHtml = parsed?.content?.trim() ?? "";
  const readableText = parsed?.textContent?.trim() ?? "";
  const article = clone.querySelector("article");
  const useArticleFallback =
    Boolean(article?.innerHTML.trim()) &&
    (!readableHtml || readableLength(readableText) < MINIMUM_READABLE_CHARACTERS);
  const html = useArticleFallback ? article!.innerHTML : readableHtml;
  const normalizedHtml = keepRemoteImages(html, clone.baseURI || originalUrl, clone);
  const plainText = useArticleFallback ? article!.textContent ?? "" : readableText;
  const isMedium = /(^|\.)medium\.com$/i.test(new URL(originalUrl).hostname) || /medium/i.test(document.title);
  const extractor = useArticleFallback ? (isMedium ? "site-adapter" : "fallback") : "readability";
  const markdown = markdownFrom(normalizedHtml);
  if (!markdown) throw new Error("未能识别可采集的正文，请确认文章已加载后重试。");
  const wordCount = countWords(plainText);
  const warnings = readableLength(plainText) < MINIMUM_READABLE_CHARACTERS ? ["content_too_short"] : [];
  if (/this story is for members only|subscribe to read the full story|sign in to (?:read|continue)|订阅后(?:阅读|查看)|登录后(?:阅读|查看)|付费阅读/i.test(plainText)) {
    warnings.push("paywall_preview");
  }

  return {
    source: extractMetadata(document, originalUrl),
    content: {
      markdown,
      excerpt: excerpt(plainText),
      wordCount,
      imageUrls: remoteImageUrls(normalizedHtml, clone.baseURI || originalUrl, clone)
    },
    capture: {
      capturedAt,
      extractor,
      contentHash: await sha256Hex(markdown),
      warnings
    }
  };
}
