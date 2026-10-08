#!/bin/sh
# Install the SilverBullet CLI (`sb`).
#
#   curl -fsSL https://silverbullet.md/install-sb.sh | sh
#   curl -fsSL https://silverbullet.md/install-sb.sh | sh -s -- --edge
#   curl -fsSL https://silverbullet.md/install-sb.sh | sh -s -- --version 2.12.0
#
# Environment: SB_INSTALL_DIR (default ~/.local/bin), SB_CHANNEL (stable|edge),
# SB_VERSION. Never uses sudo.
#
# Everything runs from `main` on the last line, so a download cut off midway
# never executes a partial script.

set -eu

RELEASES="${SB_RELEASE_BASE:-https://github.com/silverbulletmd/silverbullet/releases}"

say() { printf '%s\n' "$*" >&2; }
fail() {
  say "error: $*"
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Install the SilverBullet CLI (sb).

Usage: install-sb.sh [--edge] [--version <version>]

Environment:
  SB_INSTALL_DIR  installation directory (default: ~/.local/bin)
  SB_CHANNEL      stable (default) or edge
  SB_VERSION      a specific release, e.g. 2.12.0
EOF
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    FreeBSD) echo freebsd ;;
    *) fail "unsupported operating system: $(uname -s). Download sb from $RELEASES" ;;
  esac
}

detect_arch() {
  arch="$(uname -m)"
  # A shell running under Rosetta reports x86_64 on Apple Silicon.
  if [ "$1" = darwin ] && [ "$arch" = x86_64 ] &&
    [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  case "$arch" in
    x86_64 | amd64) echo x86_64 ;;
    arm64 | aarch64) echo aarch64 ;;
    armv7l | armv7) echo armv7 ;;
    *) fail "unsupported architecture: $arch. Download sb from $RELEASES" ;;
  esac
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https,file' -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi
}

# Extract only the sb executable from the release zip into $2.
extract() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$1" sb -d "$2"
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -x -f "$1" -C "$2" sb
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extract("sb", sys.argv[2])' "$1" "$2"
  else
    fail "unzip is required to unpack sb (install the unzip package, or bsdtar or python3)"
  fi
}

# A link left behind by older SilverBullet Desktop versions, which bundled sb.
is_desktop_link() {
  [ -L "$1" ] || return 1
  case "$(readlink "$1")" in
    */resources/app/sb | */Resources/app/sb | */.local/share/silverbullet/cli/sb) return 0 ;;
  esac
  return 1
}

path_hint() {
  case "$(basename "${SHELL:-sh}")" in
    zsh) say "  echo 'export PATH=\"$1:\$PATH\"' >> ~/.zshrc" ;;
    bash) say "  echo 'export PATH=\"$1:\$PATH\"' >> ~/.bashrc" ;;
    fish) say "  fish_add_path $1" ;;
    *) say "  export PATH=\"$1:\$PATH\"   (add this to your shell profile)" ;;
  esac
}

main() {
  channel="${SB_CHANNEL:-stable}"
  version="${SB_VERSION:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --edge) channel=edge ;;
      --version)
        [ $# -ge 2 ] || fail "--version needs a value"
        version="$2"
        shift
        ;;
      -h | --help)
        usage
        return 0
        ;;
      *) fail "unknown option: $1 (see --help)" ;;
    esac
    shift
  done

  os="$(detect_os)"
  arch="$(detect_arch "$os")"
  asset="sb-$os-$arch.zip"
  if [ -n "$version" ]; then
    url="$RELEASES/download/${version#v}/$asset"
  elif [ "$channel" = edge ]; then
    url="$RELEASES/download/edge/$asset"
  elif [ "$channel" = stable ]; then
    url="$RELEASES/latest/download/$asset"
  else
    fail "unknown channel: $channel (use stable or edge)"
  fi

  dir="${SB_INSTALL_DIR:-$HOME/.local/bin}"
  target="$dir/sb"
  mkdir -p "$dir" || fail "cannot create $dir"

  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  say "Downloading $url"
  download "$url" "$work/$asset" || fail "download failed: $url"
  extract "$work/$asset" "$work"
  [ -f "$work/sb" ] || fail "the release archive does not contain sb"

  # Replace atomically: stage next to the target, then rename over it.
  staged="$dir/.sb-install-$$"
  cp "$work/sb" "$staged"
  chmod 755 "$staged"
  if is_desktop_link "$target"; then
    say "Replacing the sb link from an older SilverBullet Desktop"
    rm -f "$target"
  fi
  mv -f "$staged" "$target"
  say "Installed $("$target" version 2>/dev/null || echo sb) to $target"

  found="$(command -v sb 2>/dev/null || true)"
  case ":$PATH:" in
    *":$dir:"*)
      if [ -n "$found" ] && [ "$found" != "$target" ]; then
        say "warning: $found comes earlier on your PATH and will run instead of $target"
      fi
      ;;
    *)
      say ""
      say "$dir is not on your PATH. To add it:"
      path_hint "$dir"
      ;;
  esac
  say ""
  say "Get started: sb space add https://notes.example.com   (or: sb --help)"
}

main "$@"
