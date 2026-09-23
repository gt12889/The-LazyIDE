const CONTROL_TAG_PATTERN = /<\|[^>]{0,160}\|>|<\/?(?:project_instructions|system|developer|user|assistant|im_start|im_end)[^>]*>/gi;
const INSTRUCTION_MARKER_PATTERN = /--+\s*(?:MANDATORY|IMPORTANT|SYSTEM|DEVELOPER|PROJECT INSTRUCTIONS)[^\r\n]*/gi;
const WHITESPACE_PATTERN = /\s+/g;

export function sanitizeAgentDisplayText(value: string | null | undefined, fallback = 'Untitled mission'): string {
  const raw = String(value ?? '');
  const cleaned = raw
    .replace(CONTROL_TAG_PATTERN, ' ')
    .replace(INSTRUCTION_MARKER_PATTERN, ' ')
    .replace(/[<>|]/g, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
  return cleaned || fallback;
}

export function truncateAgentDisplayText(value: string | null | undefined, max = 80, fallback = 'Untitled mission'): string {
  const cleaned = sanitizeAgentDisplayText(value, fallback);
  return cleaned.length > max ? `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…` : cleaned;
}
