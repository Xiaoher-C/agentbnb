import { describe, expect, it } from 'vitest';
import type { SkillConfig } from './skill-config.js';
import { skillConfigToSkill } from './publish-capability.js';

describe('skillConfigToSkill timeout metadata', () => {
  it('publishes expected_duration_ms and hard_timeout_ms from skill config', () => {
    const config: SkillConfig = {
      id: 'api-timeout-skill',
      type: 'api',
      name: 'API Timeout Skill',
      endpoint: 'https://api.example.com/run',
      method: 'POST',
      input_mapping: {},
      output_mapping: {},
      pricing: { credits_per_call: 5 },
      timeout_ms: 12_000,
      expected_duration_ms: 8_000,
      retries: 0,
    };

    const skill = skillConfigToSkill(config);
    expect(skill.expected_duration_ms).toBe(8_000);
    expect(skill.hard_timeout_ms).toBe(12_000);
  });

  it('omits timeout metadata when no timeout fields are configured', () => {
    const config: SkillConfig = {
      id: 'pipeline-no-timeout',
      type: 'pipeline',
      name: 'Pipeline Without Timeout',
      steps: [{ skill_id: 'other', input_mapping: {} }],
      pricing: { credits_per_call: 3 },
    };

    const skill = skillConfigToSkill(config);
    expect(skill.expected_duration_ms).toBeUndefined();
    expect(skill.hard_timeout_ms).toBeUndefined();
  });
});
