#!/bin/bash
# AgentBnB — One-shot repo setup
# Run this from the agentbnb/ directory

set -e

echo "🏠 Setting up AgentBnB repo..."

# 1. Init git
git init
git add -A
git commit -m "feat: AgentBnB project scaffold with GSD integration

- Capability Card schema (Zod, three-level model)
- CLI placeholder (Commander)
- GSD planning files (ROADMAP, REQUIREMENTS, config)
- CLAUDE.md for Claude Code context
- First test (CapabilityCard validation)"

# 2. Create GitHub repo and push
# Option A: If you have GitHub CLI (gh)
if command -v gh &> /dev/null; then
  gh repo create agentbnb --private --source=. --push
  echo "✅ Pushed to GitHub via gh CLI"
else
  # Option B: Manual — create repo on GitHub first, then:
  echo ""
  echo "⚠️  gh CLI not found. Do this manually:"
  echo ""
  echo "  1. Go to https://github.com/new"
  echo "  2. Create repo: agentbnb (private)"
  echo "  3. Then run:"
  echo ""
  echo "     git remote add origin git@github.com:Xiaoher-C/agentbnb.git"
  echo "     git branch -M main"
  echo "     git push -u origin main"
  echo ""
fi

# 3. Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# 4. Install GSD
echo "🔧 Installing GSD..."
npx get-shit-done-cc --claude --local

echo ""
echo "✅ AgentBnB is ready!"
echo ""
echo "Next steps:"
echo "  1. Open Claude Code:  claude"
echo "  2. Run:               /gsd:phase 1"
echo "  3. GSD will guide you through Phase 0.1 (Foundation)"
echo ""
