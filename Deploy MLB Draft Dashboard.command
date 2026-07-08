#!/bin/bash
# Double-click this file to deploy MLB Draft Dashboard to GitHub Pages.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
./deploy.sh
echo
echo "Press any key to close this window..."
read -n 1
