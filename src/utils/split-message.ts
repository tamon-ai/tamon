const DEFAULT_MAX_LENGTH = 2000;

export function splitMessage(text: string, maxLength = DEFAULT_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = maxLength;

    // Prefer splitting at paragraph boundary
    const paragraphBreak = remaining.lastIndexOf("\n\n", maxLength);
    if (paragraphBreak > maxLength * 0.5) {
      splitAt = paragraphBreak + 2;
    } else {
      // Fall back to line break
      const lineBreak = remaining.lastIndexOf("\n", maxLength);
      if (lineBreak > maxLength * 0.3) {
        splitAt = lineBreak + 1;
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}
