function absoluteUrl(value: string, baseUrl: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function preferredSrc(image: HTMLImageElement): string | undefined {
  const direct = [image.currentSrc, image.dataset.src, image.dataset.original, image.getAttribute("src")]
    .map((value) => value?.trim())
    .find(Boolean);
  if (direct) return direct;

  const candidates = image
    .getAttribute("srcset")
    ?.split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates?.at(-1);
}

export function prepareArticleClone(document: Document): Document {
  const clone = document.cloneNode(true) as Document;
  const sourceImages = [...document.images];
  const baseUrl = clone.baseURI || document.baseURI;
  [...clone.images].forEach((image, index) => {
    const source = sourceImages[index];
    const src = source ? preferredSrc(source) : preferredSrc(image);
    if (src) image.setAttribute("src", absoluteUrl(src, baseUrl));
    else image.remove();
  });

  clone.querySelectorAll("script, style, form, nav, aside, button").forEach((node) => node.remove());

  clone.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    anchor.href = absoluteUrl(anchor.getAttribute("href") ?? "", baseUrl);
  });
  clone.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    image.src = absoluteUrl(image.getAttribute("src") ?? "", baseUrl);
  });

  return clone;
}
