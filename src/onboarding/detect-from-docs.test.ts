import { describe, it, expect } from 'vitest';
import { detectFromDocs } from './detect-from-docs.js';

describe('detectFromDocs', () => {
  it('returns empty array for empty content', () => {
    expect(detectFromDocs('')).toEqual([]);
    expect(detectFromDocs('   ')).toEqual([]);
  });

  it('returns empty array when no patterns match', () => {
    const result = detectFromDocs('This is a generic readme about a todo app.');
    expect(result).toEqual([]);
  });

  it('detects OpenAI from GPT-4 mention', () => {
    const result = detectFromDocs('Uses GPT-4 for text generation');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('openai');
    expect(result[0]!.category).toBe('Text Gen');
  });

  it('detects ElevenLabs from elevenlabs mention', () => {
    const result = detectFromDocs('Voice synthesis via ElevenLabs API');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('elevenlabs');
    expect(result[0]!.category).toBe('TTS');
  });

  it('detects Anthropic from Claude mention', () => {
    const result = detectFromDocs('Powered by Claude for reasoning');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('anthropic');
  });

  it('detects Recraft', () => {
    const result = detectFromDocs('Image generation using Recraft V4');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('recraft');
    expect(result[0]!.credits_per_call).toBe(8);
  });

  it('detects Kling', () => {
    const result = detectFromDocs('Video creation with Kling AI');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('kling');
    expect(result[0]!.credits_per_call).toBe(10);
  });

  it('detects Stable Diffusion variants', () => {
    expect(detectFromDocs('Uses Stable Diffusion')[0]!.key).toBe('stable-diffusion');
    expect(detectFromDocs('Running SDXL locally')[0]!.key).toBe('stable-diffusion');
    expect(detectFromDocs('ComfyUI workflow')[0]!.key).toBe('stable-diffusion');
  });

  it('detects Whisper/STT', () => {
    expect(detectFromDocs('Whisper transcription model')[0]!.key).toBe('whisper');
    expect(detectFromDocs('Speech-to-text capability')[0]!.key).toBe('whisper');
  });

  it('detects Puppeteer/Playwright/Selenium', () => {
    expect(detectFromDocs('Uses Puppeteer for scraping')[0]!.key).toBe('puppeteer');
    expect(detectFromDocs('Playwright browser automation')[0]!.key).toBe('puppeteer');
    expect(detectFromDocs('Selenium test runner')[0]!.key).toBe('puppeteer');
  });

  it('detects FFmpeg', () => {
    const result = detectFromDocs('Media processing via FFmpeg');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('ffmpeg');
  });

  it('detects Tesseract/OCR', () => {
    expect(detectFromDocs('Tesseract OCR engine')[0]!.key).toBe('tesseract');
    expect(detectFromDocs('OCR text extraction')[0]!.key).toBe('tesseract');
  });

  it('is case insensitive', () => {
    expect(detectFromDocs('OPENAI api integration')[0]!.key).toBe('openai');
    expect(detectFromDocs('elevenlabs tts')[0]!.key).toBe('elevenlabs');
  });

  it('detects multiple APIs from a single doc', () => {
    const content = `
# My Agent

Uses GPT-4o for code review and ElevenLabs for TTS.
Also includes FFmpeg for media processing.
    `;
    const result = detectFromDocs(content);
    expect(result).toHaveLength(3);
    const keys = result.map((r) => r.key);
    expect(keys).toContain('openai');
    expect(keys).toContain('elevenlabs');
    expect(keys).toContain('ffmpeg');
  });

  it('deduplicates when same API mentioned multiple times', () => {
    const content = 'Uses GPT-4 for prompts. Also integrates with OpenAI embeddings and ChatGPT.';
    const result = detectFromDocs(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('openai');
  });

  it('returns capabilities with all required fields', () => {
    const result = detectFromDocs('Uses GPT-4o');
    expect(result[0]).toMatchObject({
      key: expect.any(String),
      name: expect.any(String),
      category: expect.any(String),
      credits_per_call: expect.any(Number),
      tags: expect.any(Array),
    });
  });
});
