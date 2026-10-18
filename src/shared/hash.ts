export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input.replace(/\r\n/g, "\n").trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
