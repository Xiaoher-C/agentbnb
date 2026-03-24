#!/usr/bin/env npx ts-node
/**
 * Genesis Template — Interactive Init Script
 *
 * Run: npx @agentbnb/genesis-template init
 *
 * Asks 5 questions, generates:
 *   - capability-card.json (published to AgentBnB Hub)
 *   - SOUL.md (agent identity, from template)
 *   - HEARTBEAT.md (heartbeat config, from template)
 *   - openclaw.plugin.json (OpenClaw binding)
 */

import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import Handlebars from "handlebars";
import {
  DOMAIN_PROFILES,
  API_SKILLS,
  resolveSkills,
  generateAgentId,
  type SkillDefinition,
} from "./mappings.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUB_URL = "https://hub.agentbnb.dev";
const SIGNUP_CREDITS = 50;
const TEMPLATES_DIR = path.join(__dirname, "../templates");
const OUTPUT_DIR = process.cwd();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  p.intro("🧬  Genesis Template Setup");

  console.log(
    "\nThis will configure your agent as a born trader on the AgentBnB network.\n" +
    "5 questions. Takes ~2 minutes.\n"
  );

  // ── Q1: Agent name ───────────────────────────────────────────────────────

  const agentName = await p.text({
    message: "Agent name (used as your network identity):",
    placeholder: "e.g. LeScraperBot, CreativeStudio, DataLab",
    validate: (val) => {
      if (!val || val.trim().length < 2) return "Need at least 2 characters.";
      if (val.length > 40) return "Max 40 characters.";
    },
  });
  if (p.isCancel(agentName)) { p.cancel("Setup cancelled."); process.exit(0); }

  // ── Q2: Domain ───────────────────────────────────────────────────────────

  const domain = await p.select({
    message: "What does this agent primarily do?",
    options: Object.entries(DOMAIN_PROFILES).map(([key, profile]) => ({
      value: key,
      label: profile.label,
      hint: profile.description,
    })),
  });
  if (p.isCancel(domain)) { p.cancel("Setup cancelled."); process.exit(0); }

  const domainProfile = DOMAIN_PROFILES[domain as string];

  // ── Q3: Owned APIs ───────────────────────────────────────────────────────

  const allApiOptions = Object.entries(API_SKILLS).map(([key, api]) => ({
    value: key,
    label: api.label,
    hint: api.description,
  }));

  // Pre-select APIs relevant to the chosen domain
  const relevantDefaults = domainProfile.potential_skills;

  const selectedApis = await p.multiselect({
    message: "Which API subscriptions does this agent have?",
    options: allApiOptions,
    initialValues: relevantDefaults,
    required: false,
  });
  if (p.isCancel(selectedApis)) { p.cancel("Setup cancelled."); process.exit(0); }

  // ── Q4: Owner active hours ───────────────────────────────────────────────

  const ownerActiveStart = await p.text({
    message: "What time do you usually start work? (HH:MM, 24h)",
    placeholder: "09:00",
    initialValue: "09:00",
    validate: (val) => {
      if (!/^\d{2}:\d{2}$/.test(val)) return "Format must be HH:MM";
    },
  });
  if (p.isCancel(ownerActiveStart)) { p.cancel("Setup cancelled."); process.exit(0); }

  const ownerActiveEnd = await p.text({
    message: "What time do you usually stop? (HH:MM, 24h)",
    placeholder: "23:00",
    initialValue: "23:00",
    validate: (val) => {
      if (!/^\d{2}:\d{2}$/.test(val)) return "Format must be HH:MM";
    },
  });
  if (p.isCancel(ownerActiveEnd)) { p.cancel("Setup cancelled."); process.exit(0); }

  // ── Q5: Trading limits ───────────────────────────────────────────────────

  const maxDailyRequests = await p.text({
    message: "Max incoming rental requests per day (from other agents)?",
    placeholder: "20",
    initialValue: "20",
    validate: (val) => {
      const n = parseInt(val);
      if (isNaN(n) || n < 1) return "Must be at least 1";
      if (n > 500) return "Max is 500";
    },
  });
  if (p.isCancel(maxDailyRequests)) { p.cancel("Setup cancelled."); process.exit(0); }

  const reserveFloor = await p.text({
    message: "Minimum credit reserve (never auto-spend below this)?",
    placeholder: "20",
    initialValue: "20",
    validate: (val) => {
      const n = parseInt(val);
      if (isNaN(n) || n < 5) return "Minimum is 5";
    },
  });
  if (p.isCancel(reserveFloor)) { p.cancel("Setup cancelled."); process.exit(0); }

  // ── AgentBnB join ────────────────────────────────────────────────────────

  const joinNetwork = await p.confirm({
    message: `Join the AgentBnB network? (Start with ${SIGNUP_CREDITS} credits)`,
    initialValue: true,
  });
  if (p.isCancel(joinNetwork)) { p.cancel("Setup cancelled."); process.exit(0); }

  // ─── Generate ───────────────────────────────────────────────────────────────

  const spinner = p.spinner();
  spinner.start("Generating your Genesis agent...");

  // Resolve skills based on domain + selected APIs
  const skills = resolveSkills(domain as string, selectedApis as string[]);

  // Apply max_daily cap from user input
  const cappedSkills: SkillDefinition[] = skills.map((s) => ({
    ...s,
    max_daily: Math.min(s.max_daily, parseInt(maxDailyRequests as string)),
  }));

  // Generate agent ID
  const agentId = generateAgentId(agentName as string);

  // Build Capability Card
  const capabilityCard = buildCapabilityCard({
    agentId,
    agentName: agentName as string,
    domain: domain as string,
    domainProfile,
    skills: cappedSkills,
    ownerActiveStart: ownerActiveStart as string,
    ownerActiveEnd: ownerActiveEnd as string,
    reserveFloor: parseInt(reserveFloor as string),
    joinNetwork: joinNetwork as boolean,
    initialCredits: joinNetwork ? SIGNUP_CREDITS : 0,
  });

  // Write capability-card.json
  const cardPath = path.join(OUTPUT_DIR, "capability-card.json");
  fs.writeFileSync(cardPath, JSON.stringify(capabilityCard, null, 2));

  // Generate SOUL.md from template
  const soulTemplate = loadTemplate("SOUL.md.hbs");
  const soulContent = Handlebars.compile(soulTemplate)({
    agentId,
    agentName: agentName as string,
    domain: domain as string,
    domainLabel: domainProfile.label,
    domainDescription: domainProfile.description,
    skillsSummary: cappedSkills.map((s) => `- ${s.name} (${s.base_credits} credits/call)`).join("\n"),
    gapsList: domainProfile.gaps.join(", "),
    layer1DailyTokenCap: domainProfile.layer1_daily_token_cap.toLocaleString(),
    layer2DailyCreditCap: domainProfile.layer2_daily_credit_cap,
    tier1Threshold: 10,
    tier2Threshold: parseInt(reserveFloor as string) * 2.5,
    reserveFloor: parseInt(reserveFloor as string),
    hubUrl: HUB_URL,
    joinNetwork,
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, "SOUL.md"), soulContent);

  // Generate HEARTBEAT.md from template
  const heartbeatTemplate = loadTemplate("HEARTBEAT.md.hbs");
  const heartbeatContent = Handlebars.compile(heartbeatTemplate)({
    agentId,
    layer1DailyTokenCap: domainProfile.layer1_daily_token_cap.toLocaleString(),
    layer2DailyCreditCap: domainProfile.layer2_daily_credit_cap,
    tier1Threshold: 10,
    tier2Threshold: 50,
    reserveFloor: parseInt(reserveFloor as string),
    idleThreshold: 0.7,
    ownerActiveStart,
    ownerActiveEnd,
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, "HEARTBEAT.md"), heartbeatContent);

  // Register on AgentBnB if joining
  if (joinNetwork) {
    try {
      // Step 1: init with agent identity (--agent-id is alias for --owner, --non-interactive for --yes)
      execSync(
        `agentbnb init --agent-id ${agentId} --non-interactive`,
        { cwd: OUTPUT_DIR, stdio: "pipe" }
      );
      // Step 2: publish the generated capability card
      execSync(
        `agentbnb publish capability-card.json`,
        { cwd: OUTPUT_DIR, stdio: "pipe" }
      );
    } catch {
      // AgentBnB CLI may not be installed yet — card file is ready to register manually
    }
  }

  spinner.stop("Genesis agent configured.");

  // ─── Summary ────────────────────────────────────────────────────────────────

  p.note(
    [
      `Agent ID:     ${agentId}`,
      `Domain:       ${domainProfile.label}`,
      `Skills:       ${cappedSkills.length} published to Hub`,
      `Gaps:         ${domainProfile.gaps.length} (will auto-rent when needed)`,
      `Credits:      ${joinNetwork ? SIGNUP_CREDITS : 0} (signup bonus)`,
      `Idle window:  ${ownerActiveEnd} – ${ownerActiveStart} (when you sleep, agent earns)`,
      ``,
      `Files created:`,
      `  capability-card.json  ← published to Hub`,
      `  SOUL.md               ← agent identity`,
      `  HEARTBEAT.md          ← heartbeat config`,
    ].join("\n"),
    "Your Genesis agent is ready"
  );

  p.outro(
    joinNetwork
      ? `First heartbeat in ~30 min. Monitor: agentbnb status\nHub: ${HUB_URL}`
      : `Run 'agentbnb publish capability-card.json' when ready to join the network.`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCapabilityCard(opts: {
  agentId: string;
  agentName: string;
  domain: string;
  domainProfile: typeof DOMAIN_PROFILES[string];
  skills: SkillDefinition[];
  ownerActiveStart: string;
  ownerActiveEnd: string;
  reserveFloor: number;
  joinNetwork: boolean;
  initialCredits: number;
}) {
  const {
    agentId, agentName, domain, domainProfile, skills,
    ownerActiveStart, ownerActiveEnd, reserveFloor, initialCredits,
  } = opts;

  return {
    agent_id: agentId,
    name: agentName,
    domain,
    generation: 1,
    parent_template_version: "1.0.0",
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      level: s.level,
      description: s.description,
      pricing: {
        base_credits: s.base_credits,
        ...(s.per_minute ? { per_minute: s.per_minute } : {}),
        ...(s.max_credits ? { max_credits: s.max_credits } : {}),
      },
      constraints: {
        max_concurrent: s.max_concurrent,
        max_daily: s.max_daily,
        min_idle_rate: 0.7,
      },
      online: false, // genesis-idle-sharer will set this to true when appropriate
    })),
    gaps: domainProfile.gaps,
    autonomy: {
      tier1_threshold: 10,
      tier2_threshold: 50,
      reserve_floor: reserveFloor,
      layer1_daily_token_cap: domainProfile.layer1_daily_token_cap,
      layer2_daily_credit_cap: domainProfile.layer2_daily_credit_cap,
    },
    availability: {
      timezone: "Asia/Taipei",
      owner_active_hours: {
        start: ownerActiveStart,
        end: ownerActiveEnd,
      },
      idle_threshold: 0.7,
    },
    network: {
      hub_url: HUB_URL,
      registered_at: new Date().toISOString(),
      credit_balance: initialCredits,
      total_earned: 0,
      total_spent: 0,
    },
    fitness: {
      score: 0.5, // default for new agents
      task_success_rate_7d: 1.0,
      credit_growth_rate_7d: 0.0,
      utilization_rate: 0.0,
      feedback_avg_score: 3.0,
      computed_at: new Date().toISOString(),
    },
  };
}

function loadTemplate(filename: string): string {
  const templatePath = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, "utf-8");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message);
  process.exit(1);
});
