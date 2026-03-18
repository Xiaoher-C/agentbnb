# AgentBnB Smart Onboarding — Auto Card Generation

## Context

Currently `agentbnb init` only creates `identity.json`. Users must manually write JSON capability cards and `publish` them separately. This is the #1 friction point for new agent onboarding.

Goal: `agentbnb init` should detect what the agent can do and auto-generate + publish capability cards. Zero JSON writing.

## Detection Priority Chain

When `agentbnb init --owner <name>` runs, try these sources in order. Stop at the first one that produces cards.

### Priority 1: SOUL.md (OpenClaw agents)

Already implemented via `agentbnb openclaw sync`. No changes needed.

### Priority 2: CLAUDE.md / AGENTS.md / README.md

For Claude Code, Cursor, Codex, and generic agents. Parse the file to extract capabilities.

**Detection logic:**
```
1. Look for files in this order:
   ./CLAUDE.md → ./AGENTS.md → ./.claude/settings.json → ./README.md
2. If found, send content to a local LLM call (or regex-based parser)
   to extract:
   - What APIs/tools the agent uses
   - What workflows/pipelines it can run
   - Input/output descriptions
3. Generate L1 cards for individual APIs, L2 cards for pipelines
```

**Implementation — DO NOT use LLM for parsing.** Use a deterministic approach:

```typescript
// src/onboarding/detect-from-docs.ts

interface DetectedCapability {
  name: string;
  description: string;
  level: 1 | 2;
  apis_used: string[];
  suggested_pricing: number;
  inputs: Array<{ name: string; type: string; description: string }>;
  outputs: Array<{ name: string; type: string; description: string }>;
}

// Regex patterns to detect known APIs/tools in markdown files
const API_PATTERNS: Record<string, { pattern: RegExp; category: string; defaultPrice: number }> = {
  'openai': { pattern: /openai|gpt-4|gpt-3|chatgpt|dall-e/i, category: 'Text Gen', defaultPrice: 3 },
  'elevenlabs': { pattern: /elevenlabs|eleven.?labs/i, category: 'TTS', defaultPrice: 5 },
  'anthropic': { pattern: /anthropic|claude/i, category: 'Text Gen', defaultPrice: 3 },
  'recraft': { pattern: /recraft/i, category: 'Image Gen', defaultPrice: 8 },
  'kling': { pattern: /kling/i, category: 'Video Gen', defaultPrice: 10 },
  'stable-diffusion': { pattern: /stable.?diffusion|sdxl|comfyui/i, category: 'Image Gen', defaultPrice: 6 },
  'whisper': { pattern: /whisper|speech.?to.?text|stt/i, category: 'STT', defaultPrice: 3 },
  'puppeteer': { pattern: /puppeteer|playwright|selenium/i, category: 'Web Scraping', defaultPrice: 2 },
  'ffmpeg': { pattern: /ffmpeg/i, category: 'Media Processing', defaultPrice: 3 },
  'tesseract': { pattern: /tesseract|ocr/i, category: 'OCR', defaultPrice: 4 },
};

export function detectFromDocs(content: string): DetectedCapability[];
```

### Priority 3: Environment Variable Scan

Scan for known API key env vars. Generate L1 cards for each detected API.

```typescript
// src/onboarding/detect-from-env.ts

const ENV_PATTERNS: Record<string, { envVar: string; name: string; category: string; defaultPrice: number }> = {
  'openai': { envVar: 'OPENAI_API_KEY', name: 'OpenAI GPT-4o', category: 'Text Gen', defaultPrice: 3 },
  'elevenlabs': { envVar: 'ELEVENLABS_API_KEY', name: 'ElevenLabs TTS', category: 'TTS', defaultPrice: 5 },
  'anthropic': { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic Claude', category: 'Text Gen', defaultPrice: 3 },
  'recraft': { envVar: 'RECRAFT_API_KEY', name: 'Recraft V4 Image Gen', category: 'Image Gen', defaultPrice: 8 },
  'kling': { envVar: 'KLING_API_KEY', name: 'Kling AI Video Gen', category: 'Video Gen', defaultPrice: 10 },
  'replicate': { envVar: 'REPLICATE_API_TOKEN', name: 'Replicate', category: 'ML Inference', defaultPrice: 5 },
  'stability': { envVar: 'STABILITY_API_KEY', name: 'Stability AI', category: 'Image Gen', defaultPrice: 6 },
  'deepgram': { envVar: 'DEEPGRAM_API_KEY', name: 'Deepgram STT', category: 'STT', defaultPrice: 3 },
  'google-ai': { envVar: 'GOOGLE_AI_API_KEY', name: 'Google Gemini', category: 'Text Gen', defaultPrice: 3 },
  'fal': { envVar: 'FAL_KEY', name: 'FAL AI', category: 'ML Inference', defaultPrice: 5 },
};

export function detectFromEnv(): DetectedCapability[];
```

### Priority 4: Interactive Fallback

If nothing is detected, prompt user:

```
No capabilities auto-detected.

What can your agent do? (describe in plain text, or pick from templates)

Templates:
  1. Text Generation (GPT-4o / Claude / Gemini)
  2. Image Generation (DALL-E / Recraft / Stable Diffusion)
  3. TTS / Voice (ElevenLabs / Google TTS)
  4. Video Generation (Kling / Runway)
  5. Code Review / Analysis
  6. Web Scraping / Data Extraction
  7. Translation
  8. Custom (describe it)

Select [1-8, comma-separated]:
```

## Modified `init` Command Flow

```typescript
// Modify src/cli/index.ts init command

async function initCommand(owner: string, options: InitOptions) {
  // Step 1: Create identity (existing)
  const identity = await createIdentity(owner);
  
  // Step 2: Auto-detect capabilities (NEW)
  console.log('\nDetecting capabilities...\n');
  
  let capabilities: DetectedCapability[] = [];
  
  // Priority 1: SOUL.md
  if (fs.existsSync('./SOUL.md')) {
    console.log('  Found SOUL.md — extracting capabilities...');
    capabilities = detectFromSoul('./SOUL.md');  // existing openclaw sync logic
  }
  
  // Priority 2: CLAUDE.md / AGENTS.md
  if (capabilities.length === 0) {
    for (const file of ['./CLAUDE.md', './AGENTS.md', './README.md']) {
      if (fs.existsSync(file)) {
        console.log(`  Found ${file} — extracting capabilities...`);
        capabilities = detectFromDocs(fs.readFileSync(file, 'utf-8'));
        if (capabilities.length > 0) break;
      }
    }
  }
  
  // Priority 3: Env vars
  if (capabilities.length === 0) {
    console.log('  Scanning environment variables...');
    capabilities = detectFromEnv();
  }
  
  // Priority 4: Interactive
  if (capabilities.length === 0) {
    capabilities = await interactiveOnboarding();
  }
  
  // Step 3: Confirm with user
  if (capabilities.length > 0) {
    console.log(`\nDetected ${capabilities.length} capabilities:\n`);
    for (const cap of capabilities) {
      const level = cap.level === 1 ? 'Atomic' : 'Pipeline';
      console.log(`  ${level}: ${cap.name} (cr ${cap.suggested_pricing}/call)`);
    }
    
    const confirm = await prompt('\nPublish these to the registry? [Y/n] ');
    if (confirm !== 'n') {
      for (const cap of capabilities) {
        const card = capabilityToCard(cap, owner);
        await publishCard(card);
        console.log(`  ✅ Published: ${cap.name}`);
      }
    }
  }
  
  console.log('\nRun `agentbnb serve` to go online.');
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/onboarding/detect-from-docs.ts` | Parse CLAUDE.md/AGENTS.md/README.md for capabilities |
| `src/onboarding/detect-from-env.ts` | Scan env vars for known API keys |
| `src/onboarding/interactive.ts` | Template-based interactive fallback |
| `src/onboarding/capability-templates.ts` | Pre-built card templates per API/tool |
| `src/onboarding/index.ts` | Re-exports + orchestrator `detectCapabilities()` |
| `src/onboarding/detect-from-docs.test.ts` | Test with sample CLAUDE.md content |
| `src/onboarding/detect-from-env.test.ts` | Test with mocked env vars |
| `src/onboarding/interactive.test.ts` | Test template selection |

## Files to Modify

| File | Change |
|------|--------|
| `src/cli/index.ts` | `init` command: add detection chain after identity creation |
| `src/index.ts` | Export onboarding module |

## Key Decisions

- **No LLM dependency** — all detection is regex/pattern-based. Fast, deterministic, offline.
- **Cards use sensible defaults** — pricing, latency, success_rate all have defaults per API type. User can edit later.
- **Pipeline detection** — if multiple APIs detected in same doc section, suggest L2 Pipeline card combining them.
- **`--skip-detect` flag** — for users who want identity-only init (backward compatible).
- **`--from <file>` flag** — explicitly point to a description file.

## Verification

1. `agentbnb init --owner test-agent` in a directory with CLAUDE.md → auto-generates cards
2. `agentbnb init --owner test-agent` with OPENAI_API_KEY set → detects and offers to publish
3. `agentbnb init --owner test-agent --skip-detect` → identity only (existing behavior)
4. All existing tests pass (no breaking changes to init)
5. New onboarding tests pass

## Test Scenarios

```
Scenario 1: CLAUDE.md with "Uses GPT-4o for code review and ElevenLabs for TTS"
  → Detects: L1 GPT-4o (cr 3), L1 ElevenLabs TTS (cr 5)

Scenario 2: No files, but OPENAI_API_KEY and RECRAFT_API_KEY in env
  → Detects: L1 OpenAI GPT-4o (cr 3), L1 Recraft V4 (cr 8)

Scenario 3: SOUL.md present (OpenClaw agent)
  → Falls through to existing openclaw sync (no change)

Scenario 4: Nothing detected
  → Interactive template menu

Scenario 5: README.md mentions "video pipeline: script → Kling → ElevenLabs → FFmpeg"
  → Detects: L1 Kling (cr 10), L1 ElevenLabs (cr 5), L2 Video Pipeline (cr 40)
```
