#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
outputs="$(terraform -chdir=infra output -json)"
value() { jq -er --arg key "$1" '.[$key].value' <<< "$outputs"; }
AWS_REGION="$(value region)"
export AWS_REGION
bucket="$(value cache_bucket)"
cache="s3://${bucket}?region=${AWS_REGION}"
mkdir -p .state
chmod 700 .state

case "${1:-}" in
  key-init)
    secret="$(value signing_secret)"
    if aws secretsmanager describe-secret --secret-id "$secret" --query VersionIdsToStages --output json | jq -e 'length > 0' >/dev/null; then
      echo 'Signing key already exists; refusing to rotate it.' >&2
      exit 1
    fi
    umask 077
    keydir="$(mktemp -d)"
    trap 'rm -f "$keydir/private" "$keydir/public"; rmdir "$keydir"' EXIT
    nix-store --generate-binary-cache-key nixed-cache "$keydir/private" "$keydir/public"
    aws secretsmanager put-secret-value --secret-id "$secret" --secret-string "file://$keydir/private" >/dev/null
    cp "$keydir/public" .state/cache-public-key
    aws s3 cp "$keydir/public" "s3://${bucket}/cache-public-key" >/dev/null
    cat .state/cache-public-key
    ;;
  build)
    target="${2:?package name required}"
    [[ "$target" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
    root="$(git rev-parse --show-toplevel)"
    stage="$(mktemp -d)"
    trap 'rm -rf -- "$stage"' EXIT
    mkdir "$stage/source"
    # Tracked files include local edits, but exclude ignored/untracked credentials.
    git -C "$root" ls-files -z | tar -C "$root" --null -T - -cf - | tar -C "$stage/source" -xf -
    mkdir -p "$stage/source/aws/scripts"
    cp buildspec.yml "$stage/source/aws/"
    cp scripts/build.sh "$stage/source/aws/scripts/"
    expected="$(nix eval --raw --no-write-lock-file "path:$stage/source#packages.x86_64-linux.${target}.outPath")"
    key="sources/$(date -u +%Y%m%dT%H%M%S)-$(cat /proc/sys/kernel/random/uuid).zip"
    (cd "$stage/source"; zip -qry "$stage/source.zip" .)
    aws s3 cp "$stage/source.zip" "s3://$(value source_bucket)/$key" >/dev/null
    envs="$(jq -cn --arg target "$target" --arg path "$expected" '[{name:"TARGET",value:$target,type:"PLAINTEXT"},{name:"EXPECTED_PATH",value:$path,type:"PLAINTEXT"}]')"
    aws codebuild start-build --project-name "$(value project)" \
      --source-location-override "$(value source_bucket)/$key" \
      --environment-variables-override "$envs" --query build.id --output text
    ;;
  status)
    aws codebuild batch-get-builds --ids "${2:?build ID required}" --query 'builds[0].{status:buildStatus,phase:currentPhase,logs:logs.deepLink}'
    ;;
  logs)
    stream="$(aws codebuild batch-get-builds --ids "${2:?build ID required}" --query 'builds[0].logs.streamName' --output text)"
    [[ "$stream" != None ]] || { echo 'Logs not available yet' >&2; exit 1; }
    aws logs tail "/aws/codebuild/$(value project)" --log-stream-names "$stream" --since 1d --follow
    ;;
  fetch)
    id="${2:?build ID required}"
    status="$(aws codebuild batch-get-builds --ids "$id" --query 'builds[0].buildStatus' --output text)"
    [[ "$status" == SUCCEEDED ]] || { echo "Build is $status, not SUCCEEDED" >&2; exit 1; }
    result="$(aws s3 cp "s3://${bucket}/results/${id//:/_}.json" -)"
    target="$(jq -er .target <<< "$result")"
    path="$(jq -er .path <<< "$result")"
    [[ "$target" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
    expected="$(nix eval --raw --no-write-lock-file "..#packages.x86_64-linux.${target}.outPath")"
    [[ "$path" == "$expected" ]] || { echo 'Local package has changed since this build; refusing stale result' >&2; exit 1; }
    [[ -f .state/cache-public-key ]] || aws s3 cp "s3://${bucket}/cache-public-key" .state/cache-public-key
    bash scripts/cache.sh credentials
    sudo env AWS_SHARED_CREDENTIALS_FILE=/var/lib/nix/nixed-cache/credentials \
      nix copy --from "$cache" --extra-trusted-public-keys "$(cat .state/cache-public-key)" "$path"
    ;;
  credentials)
    umask 077
    credentials="$(mktemp)"
    trap 'rm -f "$credentials"' EXIT
    aws configure export-credentials --format process | jq -er '
      "[default]\naws_access_key_id = \(.AccessKeyId)\naws_secret_access_key = \(.SecretAccessKey)\n" +
      (if .SessionToken then "aws_session_token = \(.SessionToken)\n" else "" end)
    ' > "$credentials"
    sudo install -d -m 700 /var/lib/nix/nixed-cache
    sudo install -m 600 "$credentials" /var/lib/nix/nixed-cache/credentials
    ;;
  *) echo 'Usage: cache.sh {key-init|build PACKAGE|status ID|logs ID|fetch ID|credentials}' >&2; exit 1 ;;
esac
