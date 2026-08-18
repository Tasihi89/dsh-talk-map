/**
 * Digest prompt: three fields, strict JSON, the conversation's own language.
 * Structure follows compaction-basic's summarizer style (structured, bounded)
 * but collapsed to what a card front and an injection preview actually need.
 */

export const DIGEST_SYSTEM_PROMPT = [
  'You are a conversation digester for a visual conversation map.',
  'Read the conversation transcript and output STRICT JSON, nothing else:',
  '{"summary": string, "keyFindings": string[], "nextStep": string}',
  '',
  'Rules:',
  '- Use the language the conversation itself is in (Chinese conversation → Chinese output).',
  '- summary: what this conversation is about and where it stands, ≤120 characters.',
  '- keyFindings: at most 5 short bullet strings — decisions made, facts established, artifacts produced.',
  '- nextStep: ONE imperative sentence naming the next concrete action to take, ≤40 characters.',
  '  The reader has ADHD and returns after days away — nextStep must be directly actionable,',
  '  never vague ("continue working" is forbidden; "run the M2 browser test" is right).',
  '- If the conversation is finished with nothing left to do, nextStep is an empty string.',
  '- Output raw JSON only: no markdown fences, no commentary.',
].join('\n')

export function digestUserPrompt(transcript: string): string {
  return `Conversation transcript (oldest first):\n\n${transcript}\n\nOutput the JSON digest now.`
}

export interface ParsedDigest {
  summary: string
  keyFindings: string[]
  nextStep: string
}

/** Tolerant parse: strips fences, grabs the outermost object, validates shape. */
export function parseDigestOutput(raw: string): ParsedDigest {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('digest output contains no JSON object')
  const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<ParsedDigest>
  if (typeof parsed.summary !== 'string' || typeof parsed.nextStep !== 'string' || !Array.isArray(parsed.keyFindings)) {
    throw new Error('digest output missing required fields')
  }
  return {
    summary: parsed.summary.slice(0, 300),
    keyFindings: parsed.keyFindings
      .filter((finding): finding is string => typeof finding === 'string')
      .slice(0, 5)
      .map(finding => finding.slice(0, 200)),
    nextStep: parsed.nextStep.slice(0, 120),
  }
}
