#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == install ]]; then
  # Versioned installer; no floating install.determinate.systems/curl-to-master.
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
  exit
fi

export PATH="/root/.nix-profile/bin:$PATH"
export AWS_REGION="${AWS_REGION:-$AWS_DEFAULT_REGION}"
: "${TARGET:?}" "${EXPECTED_PATH:?}" "${CACHE_BUCKET:?}" "${SIGNING_SECRET:?}"
cache="s3://${CACHE_BUCKET}?region=${AWS_REGION}&multipart-upload=1&compression=zstd&compression-level=3"
umask 077
aws secretsmanager get-secret-value --secret-id "$SIGNING_SECRET" --query SecretString --output text > /tmp/cache-key
trap 'rm -f /tmp/cache-key' EXIT
nix key convert-secret-to-public < /tmp/cache-key > /tmp/cache-public
cat >> /etc/nix/nix.conf <<EOF
extra-substituters = $cache
extra-trusted-public-keys = $(cat /tmp/cache-public)
EOF

# Cache successful dependencies as they finish, even if the final build fails.
# Upload failure deliberately fails the job rather than losing expensive results.
cat > /tmp/cache-hook <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec 1>&2
stage=initialization
trap 'status=$?; printf "[cache-hook] stage=%s exit=%s drv=%s\n" "$stage" "$status" "${DRV_PATH:-unknown}"' EXIT
printf '[cache-hook] start drv=%s outputs=%s\n' "${DRV_PATH:-unknown}" "${OUT_PATHS:-unset}"
read -r -a paths <<< "$OUT_PATHS"
stage=signing
printf '[cache-hook] signing %s output(s)\n' "${#paths[@]}"
nix store sign --key-file /tmp/cache-key "${paths[@]}"
printf '[cache-hook] signing complete\n'
stage=upload
printf '[cache-hook] uploading to s3://%s\n' "$CACHE_BUCKET"
nix copy --to "s3://${CACHE_BUCKET}?region=${AWS_REGION}&multipart-upload=1&compression=zstd&compression-level=3" "${paths[@]}"
printf '[cache-hook] upload complete\n'
stage=complete
EOF
chmod 700 /tmp/cache-hook

actual="$(nix eval --raw --no-write-lock-file "path:.#packages.x86_64-linux.${TARGET}.outPath")"
[[ "$actual" == "$EXPECTED_PATH" ]] || { echo 'Source snapshot does not match expected output' >&2; exit 1; }
df -h /nix /tmp
nix build --print-build-logs --no-write-lock-file --out-link /tmp/package-result \
  --option post-build-hook /tmp/cache-hook "path:.#packages.x86_64-linux.${TARGET}"
nix store sign --recursive --key-file /tmp/cache-key "$actual"
nix copy --to "$cache" "$actual"
jq -n --arg target "$TARGET" --arg path "$actual" --arg build "$CODEBUILD_BUILD_ID" \
  '{target: $target, path: $path, build: $build}' > /tmp/result.json
aws s3 cp /tmp/result.json "s3://${CACHE_BUCKET}/results/${CODEBUILD_BUILD_ID//:/_}.json"
