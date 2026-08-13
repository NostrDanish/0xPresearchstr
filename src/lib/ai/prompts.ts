/**
 * Prompts for the AI Answer Layer.
 *
 * The contract: answers are synthesized ONLY from the supplied evidence,
 * statements carry [n] citations, and the model must say so when the
 * evidence doesn't cover the question. This turns the LLM from a generic
 * chatbot into an evidence synthesizer sitting on the federated index.
 */
import type { AIEvidenceItem } from './types';

export const ANSWER_SYSTEM_PROMPT = `You are the Presearchstr answer engine — a synthesis layer over a decentralized search network.

Rules:
- Answer using ONLY the supplied evidence whenever possible.
- NEVER invent sources or URLs.
- Cite every factual statement with [n] markers referencing the evidence items.
- Clearly separate what the evidence says from your own inference.
- If the evidence is insufficient, say so plainly and say what is missing.
- Be concise: a direct answer first, then supporting detail. No preamble.`;

/** Build the user message: query + numbered evidence block. */
export function buildEvidencePrompt(query: string, evidence: AIEvidenceItem[]): string {
  const block = evidence
    .map((e) => `[${e.n}]\ntitle: ${e.title}\nurl: ${e.url}\nsnippet: ${e.snippet}`)
    .join('\n\n');

  return `QUERY:\n${query}\n\nEVIDENCE:\n${block}\n\nAnswer the query. End with a "Sources:" section listing the [n] references you actually used, one per line, exactly like "[1] <title>".`;
}
