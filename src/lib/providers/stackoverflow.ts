/**
 * Stack Overflow search provider — StackExchange API v2.3.
 *
 * Queries the public StackExchange search API. No API key needed (300 daily quota).
 * Returns questions sorted by relevance with vote counts and answer status.
 * CORS-friendly — no proxy needed.
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

interface SEItem {
  question_id: number;
  title: string;
  excerpt: string;
  question_score: number;
  answer_count: number;
  has_accepted_answer: boolean;
  is_answered: boolean;
  creation_date: number;
  last_activity_date: number;
  tags: string[];
  item_type: string;
}

interface SEResponse {
  items: SEItem[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...');
}

function toSearchResult(item: SEItem, index: number): SearchResult {
  const metaParts: string[] = [];
  if (item.question_score > 0) metaParts.push(`${item.question_score} votes`);
  if (item.answer_count > 0) metaParts.push(`${item.answer_count} answers`);
  if (item.has_accepted_answer) metaParts.push('accepted');

  return {
    id: `so-${item.question_id}`,
    title: stripHtml(item.title),
    url: `https://stackoverflow.com/questions/${item.question_id}`,
    snippet: stripHtml(item.excerpt).slice(0, 300),
    source: 'code',
    provider: 'stackoverflow',
    domain: 'stackoverflow.com',
    engine: 'Stack Overflow',
    timestamp: item.last_activity_date || item.creation_date,
    kind: item.item_type === 'answer' ? 'Answer' : 'Question',
    tags: [
      ...metaParts.slice(0, 2),
      ...item.tags.slice(0, 3),
    ],
    score: 72 - index * 0.5,
  };
}

export const stackOverflowProvider: SearchProvider = {
  id: 'stackoverflow',
  name: 'Stack Overflow',
  source: 'code',
  privacy: 'direct',
  privacyNote: 'Direct HTTPS to the Stack Exchange API. Stack Exchange sees the query + your IP.',

  async search({ query, signal, limit = 10 }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const params = new URLSearchParams({
      order: 'desc',
      sort: 'relevance',
      q: query.trim(),
      site: 'stackoverflow',
      pagesize: String(limit),
      filter: 'default',
    });

    const url = `https://api.stackexchange.com/2.3/search/excerpts?${params.toString()}`;

    try {
      const res = await fetch(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) return { results: [] };

      const data = await res.json() as SEResponse;
      const items = (data.items ?? []).filter((i) => i.item_type === 'question');

      return { results: items.map(toSearchResult) };
    } catch {
      return { results: [] };
    }
  },
};
