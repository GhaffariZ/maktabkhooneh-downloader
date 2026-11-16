#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
    printf 'Usage: sh scripts/package-unix.sh <extracted Node distribution> <output directory>\n' >&2
    exit 1
fi

repo=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
runtime=$(CDPATH= cd "$1" && pwd)
mkdir -p "$2"
output=$(CDPATH= cd "$2" && pwd)
test -x "$runtime/bin/node"
test -f "$runtime/LICENSE"
test -f "$repo/dist/server/server/server.js"
test -f "$repo/dist/client/index.html"

version=$("$runtime/bin/node" -p 'require(process.argv[1]).version' "$repo/package.json")
platform=$("$runtime/bin/node" -p 'process.platform')
arch=$("$runtime/bin/node" -p 'process.arch')
name=maktabkhooneh-study-library
title='Maktabkhooneh Study Library'
prefix="Maktabkhooneh-Study-Library-v$version"

case "$platform:$arch" in
    linux:x64) deb_arch=amd64 ;;
    linux:arm64) deb_arch=arm64 ;;
    darwin:x64|darwin:arm64) ;;
    *) printf 'Unsupported runtime: %s %s\n' "$platform" "$arch" >&2; exit 1 ;;
esac

stage=$(mktemp -d "${TMPDIR:-/tmp}/mk-desktop.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT

if [ "$platform" = linux ]; then
    artifact="$prefix-linux-$arch-preview.deb"
    payload="$stage/deb/usr/lib/$name"
else
    artifact="$prefix-macos-$arch-preview.zip"
    contents="$stage/$title.app/Contents"
    payload="$contents/Resources"
fi

if [ -e "$output/$artifact" ]; then
    printf 'Package already exists: %s\n' "$output/$artifact" >&2
    exit 1
fi

mkdir -p "$payload/runtime" "$payload/scripts"
cp -R "$repo/dist" "$repo/docs" "$payload/"
cp "$repo/package.json" "$repo/LICENSE" "$payload/"
cp "$repo/scripts/desktop.mjs" "$repo/scripts/desktop-unix.mjs" "$payload/scripts/"
cp "$runtime/bin/node" "$runtime/LICENSE" "$payload/runtime/"
chmod 755 "$payload/runtime/node"

if [ "$platform" = linux ]; then
    mkdir -p "$stage/deb/DEBIAN" "$stage/deb/usr/share/applications"
    cat > "$stage/deb/DEBIAN/control" <<EOF
Package: $name
Version: $version~preview
Section: education
Priority: optional
Architecture: $deb_arch
Maintainer: Maktabkhooneh Study Library contributors
Depends: xdg-utils, zenity
Homepage: https://github.com/GhaffariZ/maktabkhooneh-downloader
Description: Persian-first local study library
 A local browser dashboard for course streaming and offline study.
EOF
    cat > "$stage/deb/usr/share/applications/$name.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$title
Exec=/usr/bin/env -u NODE_OPTIONS -u NODE_PATH /usr/lib/$name/runtime/node /usr/lib/$name/scripts/desktop-unix.mjs
Icon=applications-multimedia
Terminal=false
Categories=Education;
EOF
    chmod 755 "$stage/deb"
    dpkg-deb --root-owner-group --build "$stage/deb" "$stage/$artifact"
else
    mkdir -p "$contents/MacOS"
    cat > "$contents/MacOS/launch" <<'EOF'
#!/bin/sh
resources=$(CDPATH= cd "$(dirname "$0")/../Resources" && pwd)
unset NODE_OPTIONS NODE_PATH
exec "$resources/runtime/node" "$resources/scripts/desktop-unix.mjs" "$@"
EOF
    chmod 755 "$contents/MacOS/launch"
    cat > "$contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIdentifier</key><string>io.github.ghaffariz.maktabkhooneh-study-library</string>
  <key>CFBundleName</key><string>$title</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
</dict></plist>
EOF
    ditto -c -k --keepParent "$stage/$title.app" "$stage/$artifact"
fi

mv "$stage/$artifact" "$output/$artifact"
printf 'Created %s\n' "$output/$artifact"
