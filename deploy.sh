#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# MLB Draft Dashboard — One-Click GitHub Pages Deploy
# ═══════════════════════════════════════════════════════════════════════════
#
# USAGE:  ./deploy.sh
#         (or double-click "Deploy MLB Draft Dashboard.command")
#
# What it does:
#   1. Verifies gh CLI + Node.js are installed (auto-installs via brew if not)
#   2. Authenticates with GitHub if needed
#   3. Runs `npm install` + `npm run build:pages`
#   4. Creates the public repo `mlb-draft-dashboard` (if it doesn't exist)
#   5. Pushes the built site to the `gh-pages` branch via `gh` CLI
#   6. Enables Pages, waits for the deploy to finish, opens the live URL
# ═══════════════════════════════════════════════════════════════════════════
set -e

REPO_NAME="mlb-draft-dashboard"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

say()  { echo -e "${BLUE}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
die()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── 1. Prereqs ──────────────────────────────────────────────────────────
say "Checking prerequisites..."
if ! command -v brew &> /dev/null; then
  die "Homebrew is required. Install: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi
command -v gh   &> /dev/null || { say "Installing gh CLI..."; brew install gh; }
command -v node &> /dev/null || { say "Installing Node.js..."; brew install node; }
ok "Prereqs OK"

# ── 2. Auth ─────────────────────────────────────────────────────────────
if ! gh auth status &> /dev/null; then
  say "Authenticating with GitHub..."
  gh auth login --web --hostname github.com --scopes "repo,workflow"
fi
GH_USER=$(gh api user --jq .login)
ok "Signed in as $GH_USER"

# ── 3. Build ────────────────────────────────────────────────────────────
say "Installing dependencies..."
npm install --silent
say "Building production bundle..."
BASE="/$REPO_NAME/" npm run build:pages > /tmp/mlb-draft-build.log 2>&1 || {
  cat /tmp/mlb-draft-build.log; die "Build failed. See log above."
}
[ -d dist ] || die "Build output missing (expected dist/)."
ok "Build complete → dist/"

# ── 4. Ensure repo exists ───────────────────────────────────────────────
if ! gh repo view "$GH_USER/$REPO_NAME" &> /dev/null; then
  say "Creating public repo $GH_USER/$REPO_NAME..."
  gh repo create "$REPO_NAME" --public --description "2026 MLB Draft Dashboard + Simulator" \
    --disable-wiki --confirm > /dev/null || true
  # Newer gh releases dropped --confirm; retry without it if that failed.
  gh repo view "$GH_USER/$REPO_NAME" &> /dev/null || \
    gh repo create "$REPO_NAME" --public --description "2026 MLB Draft Dashboard + Simulator" --disable-wiki > /dev/null
fi
ok "Repo: $GH_USER/$REPO_NAME"

# ── 5. Init source git if missing ───────────────────────────────────────
if [ ! -d .git ]; then
  say "Initializing git repo..."
  git init -q
  git branch -M main
  git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git" 2>/dev/null || \
    git remote set-url origin "https://github.com/$GH_USER/$REPO_NAME.git"
fi

# ── 6. Push source to main ──────────────────────────────────────────────
say "Committing source..."
git add -A
git commit -m "Deploy $(date +%Y-%m-%d\ %H:%M)" --quiet || warn "No source changes to commit."
say "Pushing main branch..."
git push -u origin main --quiet

# ── 7. Publish dist/ to gh-pages ────────────────────────────────────────
say "Publishing dist/ to gh-pages branch..."
TMP_PAGES="$(mktemp -d)"
cp -R dist/. "$TMP_PAGES/"
touch "$TMP_PAGES/.nojekyll"

pushd "$TMP_PAGES" > /dev/null
  git init -q
  git checkout -b gh-pages
  git add -A
  git commit -m "Publish $(date +%Y-%m-%d\ %H:%M)" --quiet
  git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git"
  git push -f origin gh-pages --quiet
popd > /dev/null
rm -rf "$TMP_PAGES"

# ── 8. Enable Pages ─────────────────────────────────────────────────────
say "Enabling GitHub Pages (source: gh-pages branch)..."
gh api "repos/$GH_USER/$REPO_NAME/pages" \
  -f source[branch]=gh-pages -f source[path]=/ \
  -X POST &> /dev/null || \
gh api "repos/$GH_USER/$REPO_NAME/pages" \
  -f source[branch]=gh-pages -f source[path]=/ \
  -X PUT &> /dev/null || true

# ── 9. Live URL ─────────────────────────────────────────────────────────
URL="https://$GH_USER.github.io/$REPO_NAME/"
ok "Deploy pushed. Live at:"
echo -e "  ${GREEN}$URL${NC}"
echo
say "Pages may take 30-90 sec on first publish. Opening browser..."
sleep 3
open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true
