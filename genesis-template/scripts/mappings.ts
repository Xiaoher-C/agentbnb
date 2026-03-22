/**
 * Genesis Template — Domain & API Mappings
 *
 * Defines what skills each domain exposes to the Hub,
 * and what capability gaps each domain typically needs to fill.
 *
 * This is the "DNA" that makes every Genesis clone a born trader
 * with both supply and demand from day one.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  level: 1 | 2 | 3;
  description: string;
  base_credits: number;
  max_credits?: number;
  per_minute?: number;
  max_concurrent: number;
  max_daily: number;
}

export interface DomainProfile {
  label: string;
  description: string;
  /** Skills this domain agent likely exposes (if it has the right APIs) */
  potential_skills: string[]; // skill IDs from API_SKILLS
  /** What this domain agent typically needs from the Hub */
  gaps: string[];
  /** Suggested Layer 1 daily token cap (heavy reasoning need varies by domain) */
  layer1_daily_token_cap: number;
  /** Suggested Layer 2 daily credit cap */
  layer2_daily_credit_cap: number;
}

export interface ApiSkill {
  /** Matches a key in API_SKILLS */
  api_key: string;
  label: string;
  description: string;
  skills: SkillDefinition[];
}

// ─── Pricing Table (base rates, agent can adjust later) ───────────────────────

export const PRICING = {
  audio_tts: { base_credits: 2, max_credits: 8 },
  image_gen_fast: { base_credits: 4, max_credits: 12 },
  image_gen_quality: { base_credits: 8, max_credits: 25 },
  image_render: { base_credits: 15, max_credits: 40 },
  video_gen: { base_credits: 20, max_credits: 60 },
  web_crawl: { base_credits: 5, max_credits: 20 },
  web_scrape_stealth: { base_credits: 8, max_credits: 30 },
  seo_analysis: { base_credits: 10, max_credits: 35 },
  reasoning_light: { base_credits: 3, max_credits: 10 },
  reasoning_heavy: { base_credits: 8, max_credits: 30 },
  code_execution: { base_credits: 5, max_credits: 20, per_minute: 2 },
  data_analysis: { base_credits: 10, max_credits: 30 },
  kb_search: { base_credits: 2, max_credits: 8 },
};

// ─── API → Skills Mapping ─────────────────────────────────────────────────────

export const API_SKILLS: Record<string, ApiSkill> = {
  elevenlabs: {
    api_key: "elevenlabs",
    label: "ElevenLabs",
    description: "Text-to-Speech synthesis",
    skills: [
      {
        id: "tts-elevenlabs",
        name: "Text-to-Speech (ElevenLabs)",
        category: "audio",
        level: 1,
        description: "High-quality multilingual TTS. Supports Traditional Chinese, English, Japanese. Returns MP3.",
        ...PRICING.audio_tts,
        max_concurrent: 3,
        max_daily: 50,
      },
    ],
  },

  midjourney: {
    api_key: "midjourney",
    label: "Midjourney",
    description: "High-quality AI image generation",
    skills: [
      {
        id: "image-midjourney",
        name: "Image Generation (Midjourney)",
        category: "image",
        level: 1,
        description: "Photorealistic and artistic image generation. Best for KV/creative work.",
        ...PRICING.image_gen_quality,
        max_concurrent: 2,
        max_daily: 30,
      },
    ],
  },

  fal: {
    api_key: "fal",
    label: "Fal.ai",
    description: "Fast AI image and video generation",
    skills: [
      {
        id: "image-fal-fast",
        name: "Fast Image Generation (Fal)",
        category: "image",
        level: 1,
        description: "FLUX-based fast image generation. Good for iterations and previews.",
        ...PRICING.image_gen_fast,
        max_concurrent: 3,
        max_daily: 60,
      },
      {
        id: "arch-render-fal",
        name: "Architectural Render Enhancement (Fal)",
        category: "render",
        level: 1,
        description: "Beautify and enhance architectural perspective renders for real estate marketing.",
        ...PRICING.image_render,
        max_concurrent: 2,
        max_daily: 20,
      },
    ],
  },

  nanobanana: {
    api_key: "nanobanana",
    label: "NanoBanana",
    description: "Architectural visualization API",
    skills: [
      {
        id: "arch-render-nanobanana",
        name: "Architectural Render Enhancement (NanoBanana)",
        category: "render",
        level: 1,
        description: "Professional-grade architectural rendering and enhancement for real estate.",
        ...PRICING.image_render,
        max_concurrent: 1,
        max_daily: 15,
      },
    ],
  },

  kling: {
    api_key: "kling",
    label: "Kling",
    description: "AI video generation",
    skills: [
      {
        id: "video-kling",
        name: "Video Generation (Kling)",
        category: "video",
        level: 1,
        description: "AI video generation from text or image. Supports motion and scene generation.",
        ...PRICING.video_gen,
        max_concurrent: 1,
        max_daily: 10,
      },
    ],
  },

  cloudflare_browser: {
    api_key: "cloudflare_browser",
    label: "Cloudflare Browser Rendering",
    description: "Full-page web crawling",
    skills: [
      {
        id: "web-crawl-cf",
        name: "Web Crawling (Cloudflare)",
        category: "data",
        level: 1,
        description: "Multi-page async web crawl via Cloudflare Browser Rendering. JS-rendered pages supported. Returns markdown.",
        ...PRICING.web_crawl,
        max_concurrent: 2,
        max_daily: 30,
      },
    ],
  },

  scrapling: {
    api_key: "scrapling",
    label: "Scrapling",
    description: "Stealth web scraping with anti-bot bypass",
    skills: [
      {
        id: "web-scrape-stealth",
        name: "Stealth Web Scraping (Scrapling)",
        category: "data",
        level: 1,
        description: "Anti-bot bypass web scraping via Camoufox. For sites that block normal crawlers.",
        ...PRICING.web_scrape_stealth,
        max_concurrent: 1,
        max_daily: 20,
      },
    ],
  },

  ahrefs: {
    api_key: "ahrefs",
    label: "Ahrefs",
    description: "SEO and competitor analysis",
    skills: [
      {
        id: "seo-ahrefs",
        name: "SEO Analysis (Ahrefs)",
        category: "seo",
        level: 1,
        description: "Keyword research, backlink analysis, competitor intelligence, traffic estimation.",
        ...PRICING.seo_analysis,
        max_concurrent: 2,
        max_daily: 25,
      },
    ],
  },

  openai: {
    api_key: "openai",
    label: "OpenAI API",
    description: "GPT reasoning and generation",
    skills: [
      {
        id: "reasoning-gpt4o",
        name: "GPT-4o Reasoning",
        category: "reasoning",
        level: 1,
        description: "Complex reasoning and analysis via GPT-4o. Best for multi-step problem solving.",
        ...PRICING.reasoning_heavy,
        max_concurrent: 3,
        max_daily: 40,
      },
    ],
  },

  anthropic: {
    api_key: "anthropic",
    label: "Anthropic API",
    description: "Claude reasoning and analysis",
    skills: [
      {
        id: "reasoning-claude",
        name: "Claude Analysis",
        category: "reasoning",
        level: 1,
        description: "Deep analysis and long-document reasoning via Claude. Excellent for nuanced content.",
        ...PRICING.reasoning_heavy,
        max_concurrent: 3,
        max_daily: 40,
      },
    ],
  },
};

// ─── Domain → Profile Mapping ─────────────────────────────────────────────────

export const DOMAIN_PROFILES: Record<string, DomainProfile> = {
  content_creation: {
    label: "內容創作 / Content Creation",
    description: "文案、影片腳本、品牌內容生產",
    potential_skills: ["elevenlabs", "midjourney", "fal", "kling"],
    gaps: [
      "code_execution",
      "seo_analysis",
      "data_visualization",
      "web_crawl",
    ],
    layer1_daily_token_cap: 80000,
    layer2_daily_credit_cap: 40,
  },

  software_dev: {
    label: "軟體開發 / Software Development",
    description: "程式開發、代碼審查、技術文件",
    potential_skills: ["openai", "anthropic", "cloudflare_browser"],
    gaps: [
      "code_execution",
      "data_analysis",
      "ui_design_mockup",
      "security_audit",
    ],
    layer1_daily_token_cap: 150000,
    layer2_daily_credit_cap: 60,
  },

  data_analysis: {
    label: "資料分析 / Data Analysis",
    description: "數據分析、報告生成、視覺化",
    potential_skills: ["openai", "anthropic"],
    gaps: [
      "code_execution",
      "web_crawl",
      "web_scrape_stealth",
      "data_visualization",
    ],
    layer1_daily_token_cap: 120000,
    layer2_daily_credit_cap: 50,
  },

  real_estate: {
    label: "房地產 / Real Estate",
    description: "房市分析、建案行銷、視覺製作",
    potential_skills: ["elevenlabs", "fal", "nanobanana", "cloudflare_browser", "scrapling"],
    gaps: [
      "code_execution",
      "seo_analysis",
      "video_gen",
      "data_visualization",
    ],
    layer1_daily_token_cap: 100000,
    layer2_daily_credit_cap: 45,
  },

  research: {
    label: "研究調查 / Research",
    description: "學術研究、市場調查、競品分析",
    potential_skills: ["cloudflare_browser", "scrapling", "ahrefs", "openai", "anthropic"],
    gaps: [
      "code_execution",
      "data_visualization",
      "translation",
      "fact_checking",
    ],
    layer1_daily_token_cap: 100000,
    layer2_daily_credit_cap: 40,
  },

  marketing: {
    label: "行銷 / Marketing",
    description: "數位行銷、廣告投放、競品監控",
    potential_skills: ["ahrefs", "midjourney", "fal", "elevenlabs"],
    gaps: [
      "code_execution",
      "data_analysis",
      "web_crawl",
      "video_gen",
    ],
    layer1_daily_token_cap: 80000,
    layer2_daily_credit_cap: 40,
  },

  finance: {
    label: "財務 / Finance",
    description: "財務報告、投資分析、風險評估",
    potential_skills: ["openai", "anthropic"],
    gaps: [
      "code_execution",
      "data_visualization",
      "web_crawl",
      "data_analysis",
    ],
    layer1_daily_token_cap: 120000,
    layer2_daily_credit_cap: 50,
  },

  education: {
    label: "教育 / Education",
    description: "課程設計、知識庫建立、學習輔助",
    potential_skills: ["elevenlabs", "openai", "anthropic"],
    gaps: [
      "code_execution",
      "image_gen",
      "data_visualization",
      "video_gen",
    ],
    layer1_daily_token_cap: 80000,
    layer2_daily_credit_cap: 30,
  },

  other: {
    label: "其他 / Other",
    description: "未列出的特殊用途",
    potential_skills: [],
    gaps: ["code_execution"],
    layer1_daily_token_cap: 100000,
    layer2_daily_credit_cap: 50,
  },
};

// ─── Helper: Get all available skills for a domain + selected APIs ─────────────

export function resolveSkills(
  domain: string,
  selectedApis: string[]
): SkillDefinition[] {
  const profile = DOMAIN_PROFILES[domain] || DOMAIN_PROFILES.other;
  const relevantApis = selectedApis.filter((api) =>
    profile.potential_skills.includes(api)
  );

  // Also include non-domain APIs the user explicitly selected
  const allApis = [...new Set([...relevantApis, ...selectedApis])];

  const skills: SkillDefinition[] = [];
  for (const apiKey of allApis) {
    const apiSkill = API_SKILLS[apiKey];
    if (apiSkill) {
      skills.push(...apiSkill.skills);
    }
  }

  return skills;
}

// ─── Helper: Generate agent_id ────────────────────────────────────────────────

export function generateAgentId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  const hash = Math.random().toString(16).slice(2, 10);
  return `genesis-${slug}-${hash}`;
}
