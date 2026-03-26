/**
 * Text-to-Video Generation Script
 *
 * Prompt: 一隻企鵝，在雨林裡驚恐奔跑，臉朝向鏡頭奔跑，鏡頭同步後拉，10秒
 *
 * Supports three providers:
 *   1. OpenAI Sora (sora-2)
 *   2. xAI Grok (grok-imagine-video)
 *   3. MiniMax Hailuo (T2V-01-Director) — best for camera control
 *
 * Usage:
 *   npx tsx scripts/generate-video.ts --provider openai
 *   npx tsx scripts/generate-video.ts --provider xai
 *   npx tsx scripts/generate-video.ts --provider minimax
 *
 * Environment variables:
 *   OPENAI_API_KEY   — for OpenAI Sora
 *   XAI_API_KEY      — for xAI Grok
 *   MINIMAX_API_KEY  — for MiniMax Hailuo
 */

import fs from 'fs';
import path from 'path';

const PROMPT_EN =
  'A terrified penguin sprinting through a lush tropical rainforest, ' +
  'facing directly toward the camera while running at full speed, ' +
  'eyes wide with panic, wings flapping frantically. ' +
  'The camera simultaneously pulls back smoothly, keeping the penguin centered ' +
  'as dense green foliage and towering trees blur past on both sides. ' +
  'Rain drips from leaves, dramatic lighting filters through the canopy. ' +
  'Cinematic, high detail, natural motion, 4K quality.';

// ─── Provider: OpenAI Sora ───────────────────────────────────────────────────

async function generateWithSora(): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  console.log('[Sora] Submitting video generation request...');

  // Step 1: Create video
  const createRes = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sora-2',
      prompt: PROMPT_EN,
      seconds: '16', // Sora supports 8, 16, 20 — use 16 (closest ≥ 10)
      size: '1280x720',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`[Sora] Create failed: ${createRes.status} ${err}`);
  }

  const job = (await createRes.json()) as {
    id: string;
    status: string;
  };
  console.log(`[Sora] Job created: ${job.id}`);

  // Step 2: Poll until completed
  const videoId = job.id;
  let status = job.status;

  while (status !== 'completed' && status !== 'failed') {
    await sleep(15_000);
    const pollRes = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const pollData = (await pollRes.json()) as {
      status: string;
      progress: number;
    };
    status = pollData.status;
    console.log(`[Sora] Status: ${status} (progress: ${pollData.progress}%)`);
  }

  if (status === 'failed') throw new Error('[Sora] Video generation failed');

  // Step 3: Download
  const contentRes = await fetch(
    `https://api.openai.com/v1/videos/${videoId}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  const outputPath = path.join(process.cwd(), `penguin-sora-${videoId}.mp4`);
  const buffer = Buffer.from(await contentRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`[Sora] Video saved: ${outputPath}`);
  return outputPath;
}

// ─── Provider: xAI Grok ─────────────────────────────────────────────────────

async function generateWithXai(): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('Missing XAI_API_KEY');

  console.log('[xAI] Submitting video generation request...');

  // Step 1: Create
  const createRes = await fetch('https://api.x.ai/v1/videos/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-imagine-video',
      prompt: PROMPT_EN,
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`[xAI] Create failed: ${createRes.status} ${err}`);
  }

  const { request_id } = (await createRes.json()) as { request_id: string };
  console.log(`[xAI] Request ID: ${request_id}`);

  // Step 2: Poll
  let status = 'pending';
  let videoUrl = '';

  while (status === 'pending') {
    await sleep(5_000);
    const pollRes = await fetch(`https://api.x.ai/v1/videos/${request_id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const pollData = (await pollRes.json()) as {
      status: string;
      video?: { url: string };
    };
    status = pollData.status;
    console.log(`[xAI] Status: ${status}`);

    if (status === 'done' && pollData.video) {
      videoUrl = pollData.video.url;
    }
  }

  if (status !== 'done' || !videoUrl)
    throw new Error(`[xAI] Generation failed with status: ${status}`);

  // Step 3: Download
  const videoRes = await fetch(videoUrl);
  const outputPath = path.join(
    process.cwd(),
    `penguin-xai-${request_id}.mp4`
  );
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`[xAI] Video saved: ${outputPath}`);
  return outputPath;
}

// ─── Provider: MiniMax Hailuo ────────────────────────────────────────────────

async function generateWithMinimax(): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('Missing MINIMAX_API_KEY');

  // MiniMax Director model supports camera commands like [Pull back]
  const directorPrompt =
    '[Pull back] ' +
    'A terrified penguin sprinting through a lush tropical rainforest, ' +
    'facing directly toward the camera while running at full speed, ' +
    'eyes wide with panic, wings flapping frantically. ' +
    'Dense green foliage and towering trees blur past on both sides. ' +
    'Rain drips from leaves, dramatic lighting filters through the canopy. ' +
    'Cinematic, high detail, natural motion.';

  console.log('[MiniMax] Submitting video generation request...');

  // Step 1: Create
  const createRes = await fetch(
    'https://api.minimax.io/v1/video_generation',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'T2V-01-Director',
        prompt: directorPrompt,
        duration: 10,
        resolution: '720P',
        prompt_optimizer: true,
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`[MiniMax] Create failed: ${createRes.status} ${err}`);
  }

  const { task_id, base_resp } = (await createRes.json()) as {
    task_id: string;
    base_resp: { status_code: number; status_msg: string };
  };

  if (base_resp.status_code !== 0)
    throw new Error(`[MiniMax] Error: ${base_resp.status_msg}`);

  console.log(`[MiniMax] Task ID: ${task_id}`);

  // Step 2: Poll
  let status = 'processing';
  let fileId = '';

  while (status === 'processing') {
    await sleep(10_000);
    const pollRes = await fetch(
      `https://api.minimax.io/v1/query/video_generation?task_id=${task_id}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    const pollData = (await pollRes.json()) as {
      status: string;
      file_id?: string;
    };
    status = pollData.status;
    console.log(`[MiniMax] Status: ${status}`);

    if (status === 'success' && pollData.file_id) {
      fileId = pollData.file_id;
    }
  }

  if (status !== 'success' || !fileId)
    throw new Error(`[MiniMax] Generation failed with status: ${status}`);

  // Step 3: Download via file API
  const fileRes = await fetch(
    `https://api.minimax.io/v1/files/retrieve?file_id=${fileId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  const fileData = (await fileRes.json()) as {
    file: { download_url: string };
  };

  const videoRes = await fetch(fileData.file.download_url);
  const outputPath = path.join(process.cwd(), `penguin-minimax-${task_id}.mp4`);
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`[MiniMax] Video saved: ${outputPath}`);
  return outputPath;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const provider = process.argv.includes('--provider')
    ? process.argv[process.argv.indexOf('--provider') + 1]
    : 'minimax';

  console.log(`\nProvider: ${provider}`);
  console.log(`Prompt: 企鵝在雨林裡驚恐奔跑，臉朝向鏡頭，鏡頭後拉，10秒\n`);

  switch (provider) {
    case 'openai':
    case 'sora':
      await generateWithSora();
      break;
    case 'xai':
    case 'grok':
      await generateWithXai();
      break;
    case 'minimax':
    case 'hailuo':
      await generateWithMinimax();
      break;
    default:
      console.error(
        `Unknown provider: ${provider}\n` +
          'Supported: openai, xai, minimax'
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
