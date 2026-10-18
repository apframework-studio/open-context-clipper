import { normalizeComparisonUrl } from "../shared/url";
import type { SourceMetadata } from "../shared/models";

type JsonLd = Record<string, unknown>;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveUrl(value: unknown, baseUrl: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function property(document: Document, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = document
      .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
      ?.getAttribute("content");
    const result = text(value);
    if (result) return result;
  }
  return undefined;
}

function jsonLdNodes(document: Document): JsonLd[] {
  const nodes: JsonLd[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const record = value as JsonLd;
      nodes.push(record);
      if (record["@graph"]) visit(record["@graph"]);
    }
  };

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      // A malformed JSON-LD block must not prevent local page capture.
    }
  }
  return nodes;
}

function firstJsonLd(nodes: JsonLd[], key: string): unknown {
  return nodes.map((node) => node[key]).find((value) => value !== undefined && value !== null);
}

function authorName(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(authorName).find(Boolean);
  if (value && typeof value === "object") return text((value as JsonLd).name);
  return text(value);
}

function jsonLdUrl(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const record = value as JsonLd;
    return text(record["@id"]) ?? text(record.url);
  }
  return text(value);
}

export function extractMetadata(document: Document, originalUrl: string): SourceMetadata {
  const baseUrl = document.baseURI || originalUrl;
  const nodes = jsonLdNodes(document);
  const canonical = document.querySelector('link[rel~="canonical"]')?.getAttribute("href");
  const jsonLdCanonical = jsonLdUrl(firstJsonLd(nodes, "mainEntityOfPage"));
  const canonicalUrl =
    resolveUrl(canonical, baseUrl) ??
    resolveUrl(jsonLdCanonical, baseUrl) ??
    resolveUrl(property(document, "og:url"), baseUrl) ??
    normalizeComparisonUrl(originalUrl);

  const mediumArticle = document.querySelector("article");
  const mediumAuthor = mediumArticle?.querySelector('a[rel~="author"], a[href*="/@"]')?.textContent;
  const mediumPublishedAt = mediumArticle?.querySelector("time")?.getAttribute("datetime");
  const openGraphLocale = property(document, "og:locale");

  return {
    originalUrl,
    canonicalUrl,
    title:
      text(firstJsonLd(nodes, "headline")) ??
      property(document, "og:title") ??
      document.title.trim(),
    author:
      authorName(firstJsonLd(nodes, "author")) ??
      property(document, "article:author", "author") ??
      text(mediumAuthor),
    siteName:
      text(firstJsonLd(nodes, "publisher") && (firstJsonLd(nodes, "publisher") as JsonLd).name) ??
      property(document, "og:site_name", "application-name"),
    publishedAt:
      text(firstJsonLd(nodes, "datePublished")) ??
      property(document, "article:published_time", "date") ??
      text(mediumPublishedAt),
    language:
      text(firstJsonLd(nodes, "inLanguage")) ??
      text(openGraphLocale)?.replace(/_/g, "-") ??
      property(document, "language") ??
      (document.documentElement.lang.trim() || undefined)
  };
}
