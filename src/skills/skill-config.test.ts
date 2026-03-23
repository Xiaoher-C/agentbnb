import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSkillsFile, expandEnvVars } from './skill-config.js';

describe('parseSkillsFile', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env['ELEVENLABS_API_KEY'] = 'test-api-key-123';
    process.env['OPENAI_KEY'] = 'sk-test';
    process.env['SOME_VAR'] = 'expanded-value';
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it('parses a valid api-type skill', () => {
    const yaml = `
skills:
  - id: tts-elevenlabs
    type: api
    name: "ElevenLabs TTS"
    provider: elevenlabs
    endpoint: "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    method: POST
    auth:
      type: bearer
      token: \${ELEVENLABS_API_KEY}
    input_mapping:
      text: body.text
      voice_id: path.voice_id
    output_mapping:
      audio: response.audio
    pricing:
      credits_per_call: 5
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.type).toBe('api');
    expect(skills[0]?.id).toBe('tts-elevenlabs');
    expect(skills[0]?.name).toBe('ElevenLabs TTS');
    if (skills[0]?.type === 'api') {
      expect(skills[0].auth?.token).toBe('test-api-key-123');
    }
  });

  it('parses a valid pipeline-type skill', () => {
    const yaml = `
skills:
  - id: video-production
    type: pipeline
    name: "AI Video Pipeline"
    steps:
      - skill_id: text-gen-gpt4o
        input_mapping:
          prompt: "Write a script"
      - skill_id: tts-elevenlabs
        input_mapping:
          text: prev.result.text
    pricing:
      credits_per_call: 40
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.type).toBe('pipeline');
    expect(skills[0]?.id).toBe('video-production');
    if (skills[0]?.type === 'pipeline') {
      expect(skills[0].steps).toHaveLength(2);
    }
  });

  it('parses a valid openclaw-type skill', () => {
    const yaml = `
skills:
  - id: creative-director
    type: openclaw
    name: "Creative Director"
    agent_name: chengwen-openclaw
    channel: telegram
    pricing:
      credits_per_call: 20
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.type).toBe('openclaw');
    if (skills[0]?.type === 'openclaw') {
      expect(skills[0].agent_name).toBe('chengwen-openclaw');
      expect(skills[0].channel).toBe('telegram');
    }
  });

  it('parses a valid command-type skill', () => {
    const yaml = `
skills:
  - id: image-comfyui
    type: command
    name: "ComfyUI Image Gen"
    command: "python3 /path/to/comfyui_api.py"
    output_type: file
    pricing:
      credits_per_call: 15
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.type).toBe('command');
    if (skills[0]?.type === 'command') {
      expect(skills[0].output_type).toBe('file');
    }
  });

  it('parses all 4 skill types from a single YAML', () => {
    const yaml = `
skills:
  - id: tts
    type: api
    name: TTS
    endpoint: "https://api.example.com/tts"
    method: POST
    input_mapping:
      text: body.text
    output_mapping:
      result: response.data
    pricing:
      credits_per_call: 5
  - id: pipeline-skill
    type: pipeline
    name: Pipeline
    steps:
      - skill_id: tts
        input_mapping:
          text: params.text
    pricing:
      credits_per_call: 10
  - id: oc-skill
    type: openclaw
    name: OpenClaw Agent
    agent_name: my-agent
    channel: webhook
    pricing:
      credits_per_call: 20
  - id: cmd-skill
    type: command
    name: Shell Command
    command: echo hello
    output_type: text
    pricing:
      credits_per_call: 1
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(4);
    const types = skills.map((s) => s.type);
    expect(types).toContain('api');
    expect(types).toContain('pipeline');
    expect(types).toContain('openclaw');
    expect(types).toContain('command');
  });

  it('returns empty array for empty skills list', () => {
    const yaml = `
skills: []
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(0);
    expect(skills).toEqual([]);
  });

  it('throws ZodError with path info for missing required fields', () => {
    const yaml = `
skills:
  - id: broken
    type: api
    name: Broken
    pricing:
      credits_per_call: 5
`;
    expect(() => parseSkillsFile(yaml)).toThrow();
  });

  it('throws for unknown type field', () => {
    const yaml = `
skills:
  - id: unknown-type
    type: unsupported
    name: Unknown
    pricing:
      credits_per_call: 5
`;
    expect(() => parseSkillsFile(yaml)).toThrow();
  });

  it('throws for invalid YAML syntax', () => {
    const invalidYaml = `
skills:
  - id: broken
    type: [invalid yaml
`;
    expect(() => parseSkillsFile(invalidYaml)).toThrow();
  });

  it('expands ${ENV_VAR} in string fields', () => {
    const yaml = `
skills:
  - id: env-test
    type: api
    name: "Env Test"
    endpoint: "https://api.example.com/v1/\${SOME_VAR}"
    method: GET
    input_mapping: {}
    output_mapping: {}
    pricing:
      credits_per_call: 1
`;
    const skills = parseSkillsFile(yaml);
    expect(skills[0]?.type).toBe('api');
    if (skills[0]?.type === 'api') {
      expect(skills[0].endpoint).toBe('https://api.example.com/v1/expanded-value');
    }
  });
});

// -----------------------------------------------------------------------
// Task 1 — capacity.max_concurrent field (Plan 51-02)
// -----------------------------------------------------------------------

describe('parseSkillsFile — capacity.max_concurrent', () => {
  it('parses api skill with capacity.max_concurrent: 2', () => {
    const yaml = `
skills:
  - id: rate-limited-tts
    type: api
    name: "Rate Limited TTS"
    endpoint: "https://api.example.com/tts"
    method: POST
    input_mapping: {}
    output_mapping: {}
    pricing:
      credits_per_call: 5
    capacity:
      max_concurrent: 2
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.capacity?.max_concurrent).toBe(2);
  });

  it('parses skill without capacity — capacity is undefined (not an error)', () => {
    const yaml = `
skills:
  - id: no-limit-skill
    type: api
    name: "No Limit Skill"
    endpoint: "https://api.example.com/tts"
    method: POST
    input_mapping: {}
    output_mapping: {}
    pricing:
      credits_per_call: 5
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.capacity).toBeUndefined();
  });

  it('throws ZodError for capacity.max_concurrent: 0 (must be positive)', () => {
    const yaml = `
skills:
  - id: zero-concurrent
    type: api
    name: "Zero Concurrent"
    endpoint: "https://api.example.com/tts"
    method: POST
    input_mapping: {}
    output_mapping: {}
    pricing:
      credits_per_call: 5
    capacity:
      max_concurrent: 0
`;
    expect(() => parseSkillsFile(yaml)).toThrow();
  });

  it('parses pipeline skill with max_concurrent', () => {
    const yaml = `
skills:
  - id: pipeline-limited
    type: pipeline
    name: "Limited Pipeline"
    steps:
      - skill_id: some-skill
        input_mapping: {}
    pricing:
      credits_per_call: 10
    capacity:
      max_concurrent: 3
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.capacity?.max_concurrent).toBe(3);
  });

  it('parses command skill with max_concurrent', () => {
    const yaml = `
skills:
  - id: cmd-limited
    type: command
    name: "Limited Command"
    command: echo hello
    output_type: text
    pricing:
      credits_per_call: 1
    capacity:
      max_concurrent: 1
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.capacity?.max_concurrent).toBe(1);
  });

  it('parses openclaw skill with max_concurrent', () => {
    const yaml = `
skills:
  - id: openclaw-limited
    type: openclaw
    name: "Limited OpenClaw"
    agent_name: my-agent
    channel: webhook
    pricing:
      credits_per_call: 20
    capacity:
      max_concurrent: 4
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.capacity?.max_concurrent).toBe(4);
  });

  it('parses conductor skill with max_concurrent', () => {
    const yaml = `
skills:
  - id: conductor-limited
    type: conductor
    name: "Limited Conductor"
    conductor_skill: orchestrate
    pricing:
      credits_per_call: 50
    capacity:
      max_concurrent: 2
`;
    const skills = parseSkillsFile(yaml);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.capacity?.max_concurrent).toBe(2);
  });
});

describe('expandEnvVars', () => {
  beforeEach(() => {
    process.env['MY_TOKEN'] = 'secret123';
    process.env['EMPTY_VAR'] = '';
  });

  afterEach(() => {
    delete process.env['MY_TOKEN'];
    delete process.env['EMPTY_VAR'];
  });

  it('expands a single env var', () => {
    expect(expandEnvVars('${MY_TOKEN}')).toBe('secret123');
  });

  it('expands env var within a larger string', () => {
    expect(expandEnvVars('Bearer ${MY_TOKEN}')).toBe('Bearer secret123');
  });

  it('expands multiple env vars in one string', () => {
    process.env['HOST'] = 'api.example.com';
    process.env['PORT'] = '3000';
    expect(expandEnvVars('https://${HOST}:${PORT}/v1')).toBe('https://api.example.com:3000/v1');
    delete process.env['HOST'];
    delete process.env['PORT'];
  });

  it('returns empty string for empty var', () => {
    expect(expandEnvVars('${EMPTY_VAR}')).toBe('');
  });

  it('throws for undefined env var', () => {
    expect(() => expandEnvVars('${UNDEFINED_VAR_XYZ}')).toThrow();
  });

  it('leaves non-env-var strings untouched', () => {
    expect(expandEnvVars('plain string')).toBe('plain string');
  });

  it('leaves strings without $ untouched', () => {
    expect(expandEnvVars('no vars here')).toBe('no vars here');
  });
});
