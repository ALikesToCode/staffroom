/**
 * Models sometimes answer in markdown even when asked for plain text. The
 * draft is shown as plain text, so the marks are removed and the words kept.
 * Stand-ins such as [Student 1] are left exactly as they are.
 */
export function plainText(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/gm, '$1$2')
    .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * The longest note the app takes. The on-device model reads a note in small
 * parts, one request each, and the teacher has to read every word of the
 * outgoing text before approving it; past this length neither is practical.
 */
export const NOTE_MAX = 8000;
