/**
 * Capability detection patterns and templates for smart onboarding.
 *
 * Pure data — regex patterns to detect known APIs/tools in markdown files,
 * and pre-built templates for the interactive fallback menu.
 */

/**
 * A detected capability from doc scanning or template selection.
 * Lightweight — converted to a full Skill via capabilitiesToV2Card().
 */
export interface DetectedCapability {
  /** Unique key for deduplication, e.g. 'openai', 'elevenlabs' */
  key: string;
  /** Human-readable name, e.g. 'OpenAI Text Generation' */
  name: string;
  /** Category label, e.g. 'Text Gen', 'TTS' */
  category: string;
  /** Default credits per call */
  credits_per_call: number;
  /** Metadata tags for FTS indexing */
  tags: string[];
}

/**
 * A regex pattern entry mapping a pattern to a DetectedCapability.
 */
export interface PatternEntry {
  /** Regex to test against document content */
  pattern: RegExp;
  /** The capability to return if the pattern matches */
  capability: DetectedCapability;
}

/**
 * Regex patterns for detecting known APIs and tools in markdown documentation.
 * Each pattern maps to a DetectedCapability with sensible defaults.
 */
export const API_PATTERNS: PatternEntry[] = [
  {
    pattern: /openai|gpt-4|gpt-3|chatgpt|dall-e/i,
    capability: { key: 'openai', name: 'OpenAI Text Generation', category: 'Text Gen', credits_per_call: 3, tags: ['llm', 'text', 'generation'] },
  },
  {
    pattern: /elevenlabs|eleven.?labs/i,
    capability: { key: 'elevenlabs', name: 'ElevenLabs TTS', category: 'TTS', credits_per_call: 5, tags: ['tts', 'audio', 'voice'] },
  },
  {
    pattern: /anthropic|claude/i,
    capability: { key: 'anthropic', name: 'Anthropic Claude', category: 'Text Gen', credits_per_call: 3, tags: ['llm', 'text', 'generation'] },
  },
  {
    pattern: /recraft/i,
    capability: { key: 'recraft', name: 'Recraft V4 Image Gen', category: 'Image Gen', credits_per_call: 8, tags: ['image', 'generation', 'design'] },
  },
  {
    pattern: /kling/i,
    capability: { key: 'kling', name: 'Kling AI Video Gen', category: 'Video Gen', credits_per_call: 10, tags: ['video', 'generation'] },
  },
  {
    pattern: /stable.?diffusion|sdxl|comfyui/i,
    capability: { key: 'stable-diffusion', name: 'Stable Diffusion Image Gen', category: 'Image Gen', credits_per_call: 6, tags: ['image', 'generation', 'diffusion'] },
  },
  {
    pattern: /whisper|speech.?to.?text|stt/i,
    capability: { key: 'whisper', name: 'Whisper Speech-to-Text', category: 'STT', credits_per_call: 3, tags: ['stt', 'audio', 'transcription'] },
  },
  {
    pattern: /puppeteer|playwright|selenium/i,
    capability: { key: 'puppeteer', name: 'Web Scraping & Automation', category: 'Web Scraping', credits_per_call: 2, tags: ['scraping', 'automation', 'browser'] },
  },
  {
    pattern: /ffmpeg/i,
    capability: { key: 'ffmpeg', name: 'FFmpeg Media Processing', category: 'Media Processing', credits_per_call: 3, tags: ['media', 'audio', 'video', 'processing'] },
  },
  {
    pattern: /tesseract|ocr/i,
    capability: { key: 'tesseract', name: 'OCR Text Extraction', category: 'OCR', credits_per_call: 4, tags: ['ocr', 'text', 'extraction'] },
  },
];

/**
 * Pre-built templates for the interactive onboarding fallback menu.
 * Shown when no capabilities are auto-detected.
 */
export const INTERACTIVE_TEMPLATES: DetectedCapability[] = [
  { key: 'openai', name: 'Text Generation (GPT-4o / Claude / Gemini)', category: 'Text Gen', credits_per_call: 3, tags: ['llm', 'text', 'generation'] },
  { key: 'image-gen', name: 'Image Generation (DALL-E / Recraft / Stable Diffusion)', category: 'Image Gen', credits_per_call: 8, tags: ['image', 'generation'] },
  { key: 'tts', name: 'TTS / Voice (ElevenLabs / Google TTS)', category: 'TTS', credits_per_call: 5, tags: ['tts', 'audio', 'voice'] },
  { key: 'video-gen', name: 'Video Generation (Kling / Runway)', category: 'Video Gen', credits_per_call: 10, tags: ['video', 'generation'] },
  { key: 'code-review', name: 'Code Review / Analysis', category: 'Code', credits_per_call: 3, tags: ['code', 'review', 'analysis'] },
  { key: 'scraping', name: 'Web Scraping / Data Extraction', category: 'Web Scraping', credits_per_call: 2, tags: ['scraping', 'data', 'extraction'] },
  { key: 'translation', name: 'Translation', category: 'Translation', credits_per_call: 3, tags: ['translation', 'language', 'text'] },
  { key: 'custom', name: 'Custom (describe it)', category: 'Custom', credits_per_call: 5, tags: ['custom'] },
];
