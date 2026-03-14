/**
 * Category inference and icon mapping for AgentBnB Hub.
 *
 * Maps known API service names and tags to visual category chips.
 * Used by capability cards to display category icons.
 */
import type { Category } from '../types.js';

/** Maps known API service names to their visual category. */
export const CATEGORY_MAP: Record<string, { id: string; label: string; iconName: string }> = {
  openai: { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  anthropic: { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  'azure-openai': { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  google: { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  cohere: { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  mistral: { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  elevenlabs: { id: 'tts', label: 'TTS', iconName: 'Volume2' },
  kling: { id: 'video_gen', label: 'Video Gen', iconName: 'Film' },
  stability: { id: 'image_gen', label: 'Image Gen', iconName: 'Image' },
  replicate: { id: 'compute', label: 'Compute', iconName: 'Cpu' },
};

/** Tag-based fallback mapping when apis_used doesn't match known services. */
const TAG_CATEGORY_MAP: Record<string, string> = {
  tts: 'tts',
  voice: 'tts',
  speech: 'tts',
  stt: 'stt',
  transcription: 'stt',
  image: 'image_gen',
  diffusion: 'image_gen',
  video: 'video_gen',
  film: 'video_gen',
  text: 'text_gen',
  llm: 'text_gen',
  generation: 'text_gen',
  code: 'code_gen',
  programming: 'code_gen',
  review: 'code_review',
  translation: 'translation',
  translate: 'translation',
  data: 'data_analysis',
  analytics: 'data_analysis',
  chart: 'data_analysis',
  ads: 'ads_campaign',
  campaign: 'ads_campaign',
  marketing: 'ads_campaign',
  audio: 'audio_edit',
  music: 'audio_edit',
  edit: 'video_edit',
  editing: 'video_edit',
  compute: 'compute',
  ml: 'compute',
  inference: 'compute',
  search: 'search',
  crawl: 'search',
};

/** Full category definitions for all 15 supported categories. */
const ALL_CATEGORIES: Record<string, Category> = {
  tts: { id: 'tts', label: 'TTS', iconName: 'Volume2' },
  stt: { id: 'stt', label: 'STT', iconName: 'Mic' },
  image_gen: { id: 'image_gen', label: 'Image Gen', iconName: 'Image' },
  video_gen: { id: 'video_gen', label: 'Video Gen', iconName: 'Film' },
  text_gen: { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  code_gen: { id: 'code_gen', label: 'Code Gen', iconName: 'Code' },
  code_review: { id: 'code_review', label: 'Code Review', iconName: 'GitPullRequest' },
  translation: { id: 'translation', label: 'Translation', iconName: 'Languages' },
  data_analysis: { id: 'data_analysis', label: 'Data Analysis', iconName: 'BarChart3' },
  ads_campaign: { id: 'ads_campaign', label: 'Ads Campaign', iconName: 'Megaphone' },
  audio_edit: { id: 'audio_edit', label: 'Audio Edit', iconName: 'Music' },
  video_edit: { id: 'video_edit', label: 'Video Edit', iconName: 'Scissors' },
  compute: { id: 'compute', label: 'Compute', iconName: 'Cpu' },
  search: { id: 'search', label: 'Search', iconName: 'Search' },
  custom: { id: 'custom', label: 'Custom', iconName: 'Puzzle' },
};

const MAX_DISPLAY_CHIPS = 4;

/**
 * Infer display categories from card metadata (apis_used + tags).
 *
 * Algorithm:
 * 1. Check apis_used against CATEGORY_MAP, deduplicate by category id
 * 2. Check tags against TAG_CATEGORY_MAP for additional categories not yet found
 * 3. Return unique categories, max MAX_DISPLAY_CHIPS
 * 4. If no matches found, return [custom]
 *
 * @param metadata - The card's metadata object (apis_used and/or tags)
 * @returns Object with categories array (max 4) and overflow count
 */
export function inferCategories(
  metadata?: { apis_used?: string[]; tags?: string[] },
): { categories: Category[]; overflow: number } {
  const seen = new Set<string>();
  const categories: Category[] = [];

  // Step 1: API name -> category lookup
  for (const api of metadata?.apis_used ?? []) {
    const entry = CATEGORY_MAP[api.toLowerCase()];
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      const cat = ALL_CATEGORIES[entry.id];
      if (cat) categories.push(cat);
    }
  }

  // Step 2: Tag-based fallback
  for (const tag of metadata?.tags ?? []) {
    const categoryId = TAG_CATEGORY_MAP[tag.toLowerCase()];
    if (categoryId && !seen.has(categoryId)) {
      seen.add(categoryId);
      const cat = ALL_CATEGORIES[categoryId];
      if (cat) categories.push(cat);
    }
  }

  // Step 3: Default to custom if nothing matched
  if (categories.length === 0) {
    return { categories: [ALL_CATEGORIES.custom], overflow: 0 };
  }

  // Step 4: Enforce max display chips
  if (categories.length > MAX_DISPLAY_CHIPS) {
    const overflow = categories.length - MAX_DISPLAY_CHIPS;
    return { categories: categories.slice(0, MAX_DISPLAY_CHIPS), overflow };
  }

  return { categories, overflow: 0 };
}

/**
 * Get the lucide-react icon name for a category ID.
 *
 * @param categoryId - The category ID (e.g. "tts", "image_gen")
 * @returns The lucide-react icon name, or "Puzzle" if unknown
 */
export function getCategoryIcon(categoryId: string): string {
  return ALL_CATEGORIES[categoryId]?.iconName ?? 'Puzzle';
}
