#!/usr/bin/env bash
# Minimal bootstrap: build/publish orchestration lives in build.py.
set -euo pipefail

curl --fail --location --retry 3 https://releases.nixos.org/nix/nix-2.31.2/install -o /tmp/install-nix
mkdir -p /nix /etc/nix
cat > /etc/nix/nix.conf <<'EOF'
experimental-features = nix-command flakes
sandbox = true
EOF
groupadd --system nixbld
for i in $(seq 1 32); do
  useradd --system --no-create-home --gid nixbld --groups nixbld \
    --home-dir /var/empty --shell /usr/sbin/nologin "nixbld$i"
done
bash /tmp/install-nix --no-daemon --yes
