/**
 * Convert plain URLs in text to Markdown [url](url) links,
 * skipping URLs already inside Markdown link syntax.
 */
export function linkify(text: string): string {
  return text.replace(
    /(?<!\]\()(?<!\[)https?:\/\/[^\s)\]]+/g,
    (url) => `[${url}](${url})`,
  );
}
