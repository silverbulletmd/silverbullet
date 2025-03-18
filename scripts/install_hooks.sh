#!/bin/sh
#
# Script to set up Git hooks for SilverBullet
#

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Get the root directory of the repository
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Create .git/hooks directory if it doesn't exist
mkdir -p "$REPO_ROOT/.git/hooks"

# Make Git use the hooks in .githooks
git config core.hooksPath .githooks

echo "Git hooks installed successfully from .githooks directory."
echo "To bypass hooks when committing, use 'git commit --no-verify'"