#!/bin/sh

set -e

if ! command -v unzip >/dev/null; then
	echo "Error: unzip is required to install SilverBullet." 1>&2
	exit 1
fi

case $(uname -sm) in
"Darwin x86_64") target="darwin-x86_64" ;;
"Darwin arm64") target="darwin-aarch64" ;;
"Linux arm64") target="linux-aarch64" ;;
*) target="linux-x86_64" ;;
esac

echo "Installing for $target"

if [ $# -eq 0 ]; then
	sb_uri="https://github.com/silverbulletmd/silverbullet/releases/latest/download/silverbullet-server-${target}.zip"
else
	sb_uri="https://github.com/silverbulletmd/silverbullet/releases/download/${1}/silverbullet-server-${target}.zip"
fi
exe=silverbullet
bin_dir=.

curl --fail --location --progress-bar --output "$exe.zip" "$sb_uri"
unzip -d "$bin_dir" -o "$exe.zip"
chmod +x "$exe"
rm "$exe.zip"

echo "SilverBullet server was installed successfully to $bin, run it directly via ./$exe or move it to a more convenient place."