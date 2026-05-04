#!/usr/bin/env bash
# check-v10-launch.sh — automated pre-launch verification for v10 Agent Maturity Rental
#
# Runs every check that does NOT require eyeballs on a browser. Manual items
# are tracked in docs/v10-launch-checklist.md. Launch runbook lives in
# docs/v10-launch-runbook.md.
#
# Exit codes:
#   0 — every block-severity check passed
#   1 — at least one block-severity check failed
#
# Usage:
#   bash scripts/check-v10-launch.sh
#
# This script is intentionally tolerant: each check is wrapped so a single
# failure cannot crash the script. The summary at the end shows status per
# check.

set -u  # strict on undefined vars; do NOT set -e (we want to keep going)

# ---------- ANSI colors ----------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'
  C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_GREEN=""
  C_RED=""
  C_YELLOW=""
  C_BLUE=""
  C_DIM=""
  C_BOLD=""
  C_RESET=""
fi

# ---------- locate repo root ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ---------- result tracking ----------
declare -a CHECK_NAMES=()
declare -a CHECK_STATUSES=()  # PASS / FAIL / SKIP / WARN
declare -a CHECK_SEVERITIES=()  # block / warn / nice-to-have

record() {
  local name="$1"
  local status="$2"
  local severity="$3"
  CHECK_NAMES+=("${name}")
  CHECK_STATUSES+=("${status}")
  CHECK_SEVERITIES+=("${severity}")
}

print_header() {
  echo ""
  echo "${C_BOLD}${C_BLUE}== $1 ==${C_RESET}"
}

print_check() {
  # $1 = name, $2 = status, $3 = note
  local name="$1"
  local status="$2"
  local note="${3:-}"
  local color
  case "${status}" in
    PASS) color="${C_GREEN}" ;;
    FAIL) color="${C_RED}" ;;
    WARN) color="${C_YELLOW}" ;;
    SKIP) color="${C_DIM}" ;;
    *)    color="${C_RESET}" ;;
  esac
  printf "  %s[%s]%s %s" "${color}" "${status}" "${C_RESET}" "${name}"
  if [[ -n "${note}" ]]; then
    printf " %s(%s)%s" "${C_DIM}" "${note}" "${C_RESET}"
  fi
  printf "\n"
}

echo "${C_BOLD}AgentBnB v10 launch verification${C_RESET}"
echo "${C_DIM}Repo: ${REPO_ROOT}${C_RESET}"
echo "${C_DIM}Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)${C_RESET}"

# =====================================================================
# Category 3 — codebase residue (skill marketplace residue)
# =====================================================================
print_header "3. Codebase — skill-marketplace residue"

residue_check() {
  local name="grep skill-marketplace residue"
  # Only scan surface files. Exclude ADRs (which legitimately reference the
  # historical framing). Exclude lines that explicitly call the old framing
  # out as superseded — "deprecated", "pivoted from", "v10 framing", and
  # "supersedes" are all valid mention contexts.
  local matches
  matches="$(grep -nEi "skill marketplace|skill directory" \
    README.md \
    docs/strategy/*.md \
    docs/founding-providers.md \
    hub/src/components/*.tsx \
    hub/src/pages/*.tsx \
    2>/dev/null \
    | grep -viE "deprecated|pivoted from|v10 framing|supersedes|not a skill" \
    || true)"

  if [[ -z "${matches}" ]]; then
    print_check "${name}" "PASS" "no residue in surface files"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "found residue"
    echo "${matches}" | sed 's/^/      /'
    record "${name}" "FAIL" "block"
  fi
}
residue_check

# =====================================================================
# Category 4 — privacy contract
# =====================================================================
print_header "4. Privacy contract — ADR-024"

privacy_test_check() {
  local name="src/session/privacy.test.ts (8 tests)"
  if ! command -v pnpm >/dev/null 2>&1; then
    print_check "${name}" "SKIP" "pnpm not on PATH"
    record "${name}" "SKIP" "block"
    return
  fi
  if pnpm vitest run src/session/privacy.test.ts >/tmp/v10-privacy.log 2>&1; then
    print_check "${name}" "PASS" "see /tmp/v10-privacy.log"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "see /tmp/v10-privacy.log"
    record "${name}" "FAIL" "block"
  fi
}
privacy_test_check

# =====================================================================
# Category 5 — full test suite + tsc + hub build
# =====================================================================
print_header "5. Test suite + builds"

full_vitest_check() {
  local name="full vitest suite"
  if ! command -v pnpm >/dev/null 2>&1; then
    print_check "${name}" "SKIP" "pnpm not on PATH"
    record "${name}" "SKIP" "block"
    return
  fi
  if pnpm vitest run >/tmp/v10-vitest.log 2>&1; then
    print_check "${name}" "PASS" "see /tmp/v10-vitest.log"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "see /tmp/v10-vitest.log"
    record "${name}" "FAIL" "block"
  fi
}
full_vitest_check

hub_build_check() {
  local name="hub build (pnpm --filter hub build)"
  if ! command -v pnpm >/dev/null 2>&1; then
    print_check "${name}" "SKIP" "pnpm not on PATH"
    record "${name}" "SKIP" "block"
    return
  fi
  if [[ ! -d hub ]]; then
    print_check "${name}" "SKIP" "no hub/ directory"
    record "${name}" "SKIP" "block"
    return
  fi
  # hub uses --ignore-workspace per package.json scripts. Skip install if
  # hub/node_modules is already populated to keep the launch check fast.
  local install_step="echo 'hub deps already installed'"
  if [[ ! -d hub/node_modules ]]; then
    install_step="pnpm install --ignore-workspace --silent"
  fi
  if (cd hub && eval "${install_step}" && pnpm build) \
       >/tmp/v10-hub-build.log 2>&1; then
    print_check "${name}" "PASS" "see /tmp/v10-hub-build.log"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "see /tmp/v10-hub-build.log"
    record "${name}" "FAIL" "block"
  fi
}
hub_build_check

# =====================================================================
# Category 6 — Hermes plugin
# =====================================================================
print_header "6. Hermes plugin"

hermes_readme_check() {
  local name="hermes-plugin/README.md install instructions"
  if [[ ! -f hermes-plugin/README.md ]]; then
    print_check "${name}" "FAIL" "file missing"
    record "${name}" "FAIL" "block"
    return
  fi
  if grep -q "hermes plugin install agentbnb" hermes-plugin/README.md \
     && grep -q "hermes agentbnb publish" hermes-plugin/README.md; then
    print_check "${name}" "PASS" "two-command onboarding present"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "two-command onboarding missing"
    record "${name}" "FAIL" "block"
  fi
}
hermes_readme_check

hermes_pytest_check() {
  local name="hermes-plugin pytest tests"
  if [[ ! -d hermes-plugin/tests ]]; then
    print_check "${name}" "SKIP" "no tests/ dir"
    record "${name}" "SKIP" "block"
    return
  fi
  local runner
  if command -v uv >/dev/null 2>&1; then
    runner="uv run pytest"
  elif command -v pytest >/dev/null 2>&1; then
    runner="pytest"
  else
    print_check "${name}" "SKIP" "uv and pytest both unavailable"
    record "${name}" "SKIP" "block"
    return
  fi
  if (cd hermes-plugin && ${runner} tests/) >/tmp/v10-hermes-pytest.log 2>&1; then
    print_check "${name}" "PASS" "see /tmp/v10-hermes-pytest.log"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "see /tmp/v10-hermes-pytest.log"
    record "${name}" "FAIL" "block"
  fi
}
hermes_pytest_check

hermes_example_rental_check() {
  local name="hermes-plugin/examples/RENTAL.md"
  if [[ -f hermes-plugin/examples/RENTAL.md ]]; then
    print_check "${name}" "PASS" "starter persona present"
    record "${name}" "PASS" "warn"
  else
    print_check "${name}" "FAIL" "missing"
    record "${name}" "FAIL" "warn"
  fi
}
hermes_example_rental_check

# =====================================================================
# Category 7 — documentation
# =====================================================================
print_header "7. Documentation"

doc_exists_check() {
  local name="$1"
  local path="$2"
  local severity="$3"
  if [[ -f "${path}" && -s "${path}" ]]; then
    print_check "${name}" "PASS" "${path}"
    record "${name}" "PASS" "${severity}"
  else
    print_check "${name}" "FAIL" "${path} missing or empty"
    record "${name}" "FAIL" "${severity}"
  fi
}

doc_exists_check "ADR-022 (Agent Maturity Rental)" "docs/adr/022-agent-maturity-rental.md" "block"
doc_exists_check "ADR-023 (Session Primitive)"      "docs/adr/023-session-as-protocol-primitive.md" "block"
doc_exists_check "ADR-024 (Privacy Boundary)"       "docs/adr/024-privacy-boundary.md" "block"
doc_exists_check "Hermes plugin spec"               "docs/hermes-plugin-spec.md" "warn"
doc_exists_check "Session smoke test"               "docs/session-smoke-test.md" "warn"
doc_exists_check "Founding Providers"               "docs/founding-providers.md" "warn"
doc_exists_check "Founding Renters"                 "docs/founding-renters.md" "nice-to-have"
doc_exists_check "Supply Outreach Template"         "docs/supply-outreach-template.md" "nice-to-have"
doc_exists_check "v10 launch checklist"             "docs/v10-launch-checklist.md" "block"
doc_exists_check "v10 launch runbook"               "docs/v10-launch-runbook.md" "block"

# =====================================================================
# Category 8 — infra reachability
# =====================================================================
print_header "8. Infra"

relay_health_check() {
  local name="agentbnb.fly.dev /health"
  if ! command -v curl >/dev/null 2>&1; then
    print_check "${name}" "SKIP" "curl unavailable"
    record "${name}" "SKIP" "block"
    return
  fi
  if curl -fsS --max-time 10 https://agentbnb.fly.dev/health >/dev/null 2>&1; then
    print_check "${name}" "PASS" "200 OK"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "unreachable or non-2xx"
    record "${name}" "FAIL" "block"
  fi
}
relay_health_check

apex_dns_check() {
  local name="agentbnb.dev resolves"
  if ! command -v curl >/dev/null 2>&1; then
    print_check "${name}" "SKIP" "curl unavailable"
    record "${name}" "SKIP" "block"
    return
  fi
  if curl -fsSI --max-time 10 https://agentbnb.dev/ >/dev/null 2>&1; then
    print_check "${name}" "PASS" "HTTPS responding"
    record "${name}" "PASS" "block"
  else
    print_check "${name}" "FAIL" "unreachable"
    record "${name}" "FAIL" "block"
  fi
}
apex_dns_check

# =====================================================================
# Category 9 — branding
# =====================================================================
print_header "9. Branding (nice-to-have)"

branding_banner_check() {
  local name="docs/banner.svg"
  if [[ -f docs/banner.svg ]]; then
    print_check "${name}" "PASS" "present"
    record "${name}" "PASS" "nice-to-have"
  else
    print_check "${name}" "WARN" "missing — log as follow-up"
    record "${name}" "WARN" "nice-to-have"
  fi
}
branding_banner_check

# =====================================================================
# Summary
# =====================================================================
print_header "Summary"

block_pass=0
block_fail=0
warn_pass=0
warn_fail=0
nth_pass=0
nth_fail=0

for i in "${!CHECK_NAMES[@]}"; do
  status="${CHECK_STATUSES[$i]}"
  severity="${CHECK_SEVERITIES[$i]}"
  case "${severity}" in
    block)
      if [[ "${status}" == "PASS" ]]; then ((block_pass++))
      else ((block_fail++)); fi
      ;;
    warn)
      if [[ "${status}" == "PASS" ]]; then ((warn_pass++))
      else ((warn_fail++)); fi
      ;;
    nice-to-have)
      if [[ "${status}" == "PASS" ]]; then ((nth_pass++))
      else ((nth_fail++)); fi
      ;;
  esac
done

echo ""
printf "  ${C_BOLD}block:${C_RESET}        %s%d pass%s / %s%d fail%s\n" \
  "${C_GREEN}" "${block_pass}" "${C_RESET}" "${C_RED}" "${block_fail}" "${C_RESET}"
printf "  ${C_BOLD}warn:${C_RESET}         %s%d pass%s / %s%d fail%s\n" \
  "${C_GREEN}" "${warn_pass}" "${C_RESET}" "${C_YELLOW}" "${warn_fail}" "${C_RESET}"
printf "  ${C_BOLD}nice-to-have:${C_RESET} %s%d pass%s / %s%d fail%s\n" \
  "${C_GREEN}" "${nth_pass}" "${C_RESET}" "${C_DIM}" "${nth_fail}" "${C_RESET}"
echo ""

if [[ "${block_fail}" -gt 0 ]]; then
  echo "${C_RED}${C_BOLD}LAUNCH BLOCKED:${C_RESET} ${block_fail} block-severity check(s) failed."
  echo "${C_DIM}Inspect /tmp/v10-*.log for details. See docs/v10-launch-checklist.md for the manual items.${C_RESET}"
  exit 1
fi

if [[ "${warn_fail}" -gt 0 ]]; then
  echo "${C_YELLOW}${C_BOLD}LAUNCH OK with warnings:${C_RESET} ${warn_fail} warn-severity check(s) failed — track as follow-up."
else
  echo "${C_GREEN}${C_BOLD}LAUNCH READY:${C_RESET} all automated checks green."
fi
echo "${C_DIM}Manual items remain — see docs/v10-launch-checklist.md and docs/v10-launch-runbook.md.${C_RESET}"
exit 0
