#!/bin/bash
# AgentBnB Development tmux Setup
# 用法: bash tmux-agentbnb.sh
# 
# 設計給 Cheng Wen 的工作習慣：
# - Mac Mini 跑 Claude Code (主力開發)
# - 多個 Claude Code session 同時跑不同任務
# - 需要監控 agentbnb serve + openclaw daemon
# - 需要快速切換和查看各 session 狀態

SESSION="agentbnb"
REPO="$HOME/Github/agentbnb"

# 如果 session 已存在，直接 attach
tmux has-session -t $SESSION 2>/dev/null
if [ $? == 0 ]; then
  echo "Session '$SESSION' already exists. Attaching..."
  tmux attach -t $SESSION
  exit 0
fi

# ============================================
# 建立 session + 6 個 window
# ============================================

# Window 0: Claude Code — Main (V8 Phase 1)
tmux new-session -d -s $SESSION -n "cc-main" -c $REPO
tmux send-keys -t $SESSION:0 "echo '🔨 Main Claude Code session — V8 Phase 1'" Enter
tmux send-keys -t $SESSION:0 "echo 'Run: claude'" Enter

# Window 1: Claude Code — Secondary (parallel tasks)
tmux new-window -t $SESSION:1 -n "cc-parallel" -c $REPO
tmux send-keys -t $SESSION:1 "echo '🔨 Parallel Claude Code session — bug fixes / Hub UI / Genesis'" Enter
tmux send-keys -t $SESSION:1 "echo 'Run: claude'" Enter

# Window 2: Claude Code — Exploration / Research
tmux new-window -t $SESSION:2 -n "cc-explore" -c $REPO
tmux send-keys -t $SESSION:2 "echo '🔍 Exploration session — read code, debug, investigate'" Enter
tmux send-keys -t $SESSION:2 "echo 'Run: claude'" Enter

# Window 3: Services Monitor (serve + openclaw)
tmux new-window -t $SESSION:3 -n "services" -c $REPO
# 上下分割：上面 agentbnb serve，下面 openclaw status
tmux split-window -t $SESSION:3 -v -c $REPO
tmux send-keys -t $SESSION:3.0 "echo '📡 AgentBnB serve monitor'" Enter
tmux send-keys -t $SESSION:3.0 "echo 'Run: agentbnb serve --announce'" Enter
tmux send-keys -t $SESSION:3.1 "echo '🦞 OpenClaw daemon monitor'" Enter
tmux send-keys -t $SESSION:3.1 "echo 'Run: openclaw daemon status'" Enter

# Window 4: Tests & Deploy
tmux new-window -t $SESSION:4 -n "test-deploy" -c $REPO
tmux send-keys -t $SESSION:4 "echo '✅ Test & Deploy window'" Enter
tmux send-keys -t $SESSION:4 "echo 'pnpm test / pnpm build:all / fly deploy'" Enter

# Window 5: Git & Misc
tmux new-window -t $SESSION:5 -n "git" -c $REPO
tmux send-keys -t $SESSION:5 "echo '📝 Git operations & misc'" Enter
tmux send-keys -t $SESSION:5 "echo 'git status / git log / git diff'" Enter

# ============================================
# 回到第一個 window
# ============================================
tmux select-window -t $SESSION:0

# ============================================
# Attach
# ============================================
echo ""
echo "🚀 AgentBnB tmux session created with 6 windows:"
echo ""
echo "  0: cc-main      — Main Claude Code (V8 Phase 1)"
echo "  1: cc-parallel   — Parallel Claude Code (bugs/UI/Genesis)"
echo "  2: cc-explore    — Exploration / Research"
echo "  3: services      — serve + openclaw monitor (split)"
echo "  4: test-deploy   — pnpm test / fly deploy"
echo "  5: git           — git operations"
echo ""
echo "Quick keys:"
echo "  Ctrl+B, 0-5     — switch window"
echo "  Ctrl+B, n/p      — next/prev window"
echo "  Ctrl+B, d        — detach (sessions keep running)"
echo "  Ctrl+B, w        — window list"
echo ""

tmux attach -t $SESSION
