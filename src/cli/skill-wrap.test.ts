import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  extractParamsFromTemplate,
  parseHelpOutput,
  suggestPrice,
  appendToSkillsYaml,
  scanCliAnythingBinaries,
} from './skill-wrap.js';

describe('skill-wrap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-skill-wrap-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractParamsFromTemplate', () => {
    it('extracts single param', () => {
      expect(extractParamsFromTemplate('echo ${params.message}')).toEqual(['message']);
    });

    it('extracts multiple params', () => {
      expect(extractParamsFromTemplate('cli render --scene ${params.scene} --format ${params.format}')).toEqual(['scene', 'format']);
    });

    it('deduplicates params', () => {
      expect(extractParamsFromTemplate('echo ${params.x} ${params.x}')).toEqual(['x']);
    });

    it('returns empty for no params', () => {
      expect(extractParamsFromTemplate('echo hello')).toEqual([]);
    });

    it('ignores non-params patterns', () => {
      expect(extractParamsFromTemplate('echo ${ENV_VAR} ${params.real}')).toEqual(['real']);
    });
  });

  describe('parseHelpOutput', () => {
    it('extracts subcommands from standard help', () => {
      const help = `
My CLI Tool v1.0

Usage: mycli <command> [options]

Commands:
  render    Render a 3D scene to image
  export    Export model to different format
  preview   Preview scene in real-time

Options:
  -h, --help     Show help
  -v, --version  Show version
`;
      const result = parseHelpOutput(help);
      expect(result.description).toBe('My CLI Tool v1.0');
      expect(result.subcommands).toHaveLength(3);
      expect(result.subcommands[0]).toEqual({ name: 'render', description: 'Render a 3D scene to image' });
      expect(result.subcommands[1]).toEqual({ name: 'export', description: 'Export model to different format' });
      expect(result.subcommands[2]).toEqual({ name: 'preview', description: 'Preview scene in real-time' });
    });

    it('handles empty help output', () => {
      const result = parseHelpOutput('');
      expect(result.description).toBe('');
      expect(result.subcommands).toEqual([]);
    });

    it('handles help with no subcommands section', () => {
      const help = `
A simple tool that does one thing.

Usage: tool [options] <input>

Options:
  --output <file>  Output file
  --verbose        Enable verbose mode
`;
      const result = parseHelpOutput(help);
      expect(result.description).toBe('A simple tool that does one thing.');
      expect(result.subcommands).toEqual([]);
    });

    it('handles "Available commands:" header', () => {
      const help = `
CLI-Anything Blender

Available commands:
  render      Render scenes
  model       Manage models
`;
      const result = parseHelpOutput(help);
      expect(result.subcommands).toHaveLength(2);
    });
  });

  describe('suggestPrice', () => {
    it('returns category price when provided', () => {
      expect(suggestPrice('anything', '3d-rendering')).toBe(15);
      expect(suggestPrice('anything', 'web-crawling')).toBe(3);
    });

    it('infers category from binary name', () => {
      expect(suggestPrice('blender-render')).toBe(15);
      expect(suggestPrice('cli-anything-gimp')).toBe(8);
      expect(suggestPrice('ffmpeg-convert')).toBe(12);
    });

    it('returns default for unknown binary', () => {
      expect(suggestPrice('unknown-tool')).toBe(5);
    });
  });

  describe('appendToSkillsYaml', () => {
    it('creates skills.yaml if missing', () => {
      const yamlPath = join(tmpDir, 'skills.yaml');
      expect(existsSync(yamlPath)).toBe(false);

      appendToSkillsYaml(
        { id: 'test-skill', type: 'command', name: 'Test', command: 'echo hello', output_type: 'text', pricing: { credits_per_call: 5 } },
        tmpDir,
      );

      expect(existsSync(yamlPath)).toBe(true);
      const content = readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(content) as unknown[];
      expect(parsed).toHaveLength(1);
      expect((parsed[0] as Record<string, unknown>)['id']).toBe('test-skill');
    });

    it('appends to existing skills.yaml', () => {
      const yamlPath = join(tmpDir, 'skills.yaml');
      writeFileSync(yamlPath, yaml.dump([{ id: 'existing', type: 'command', name: 'Existing' }]));

      appendToSkillsYaml(
        { id: 'new-skill', type: 'command', name: 'New', command: 'echo new', output_type: 'text', pricing: { credits_per_call: 3 } },
        tmpDir,
      );

      const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as unknown[];
      expect(parsed).toHaveLength(2);
      expect((parsed[0] as Record<string, unknown>)['id']).toBe('existing');
      expect((parsed[1] as Record<string, unknown>)['id']).toBe('new-skill');
    });

    it('handles object-style skills.yaml', () => {
      const yamlPath = join(tmpDir, 'skills.yaml');
      writeFileSync(yamlPath, yaml.dump({ skills: [{ id: 'old', type: 'command', name: 'Old' }] }));

      appendToSkillsYaml(
        { id: 'wrapped', type: 'command', name: 'Wrapped', command: 'test', output_type: 'text', pricing: { credits_per_call: 2 } },
        tmpDir,
      );

      const content = readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(content) as unknown[];
      expect(parsed).toHaveLength(2);
    });

    it('rejects duplicate skill ID', () => {
      appendToSkillsYaml(
        { id: 'dupe', type: 'command', name: 'First', command: 'x', output_type: 'text', pricing: { credits_per_call: 1 } },
        tmpDir,
      );

      expect(() =>
        appendToSkillsYaml(
          { id: 'dupe', type: 'command', name: 'Second', command: 'y', output_type: 'text', pricing: { credits_per_call: 1 } },
          tmpDir,
        ),
      ).toThrow('already exists');
    });
  });

  describe('scanCliAnythingBinaries', () => {
    it('returns array (may be empty if none installed)', () => {
      const result = scanCliAnythingBinaries();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
