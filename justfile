# --- System Management ---

check-auth:
  aws sts get-caller-identity

gc:
  sudo nix-collect-garbage --delete-old
  sudo nix-store --gc

# --- nixos ---

nixos-switch:
  sudo nixos-rebuild switch --flake .#default

nixos-boot:
  sudo nixos-rebuild boot --flake .#default

# --- darwin ---

darwin-switch:
  sudo darwin-rebuild switch --flake .#M1

# --- amadeus ---

amadeus-install:
  #!/usr/bin/env bash
  set -euo pipefail
  sudo nix profile remove 0 >/dev/null 2>&1 || true
  sudo nix profile install .#amadeus --impure
  /nix/var/nix/profiles/default/bin/private-fonts-profile-watch-install

amadeus-upgrade:
  #!/usr/bin/env bash
  set -euo pipefail
  sudo nix profile upgrade 0 --impure
  /nix/var/nix/profiles/default/bin/private-fonts-profile-watch-install

# --- font ---

font-encrypt src name:
  #!/usr/bin/env bash
  set -euo pipefail
  mkdir -p secrets/fonts
  archive="{{name}}.tar.gz.age"
  archive_json="$(nix eval --impure --raw --expr "builtins.toJSON \"$archive\"")"
  nix eval --impure --raw --expr "let manifest = import ./common/private-fonts-manifest.nix; in if builtins.any (font: font.archive == $archive_json) manifest then \"ok\" else builtins.throw \"unknown private font archive: $archive\"" >/dev/null
  tmp="$(mktemp --suffix=.tar.gz)"
  trap 'rm -f "$tmp"' EXIT
  tar -C "$(dirname "{{src}}")" -czf "$tmp" "$(basename "{{src}}")"
  keys_expr="builtins.concatStringsSep \"\\n\" ((import ./secrets/secrets.nix).\"fonts/$archive\".publicKeys)"
  keys="$(nix eval --impure --raw --expr "$keys_expr")"
  recipients=()
  while IFS= read -r k; do
    [ -n "$k" ] && recipients+=("-r" "$k")
  done <<< "$keys"
  age "${recipients[@]}" -o "secrets/fonts/{{name}}.tar.gz.age" "$tmp"

font-rekey:
  #!/usr/bin/env bash
  set -euo pipefail
  identity="${AGENIX_IDENTITY:-$HOME/.ssh/agenix}"
  shopt -s nullglob
  files=(secrets/fonts/*.age)
  if ((${#files[@]} == 0)); then
    echo "no private font archives found" >&2
    exit 1
  fi

  stage="$(mktemp -d secrets/fonts/.font-rekey.XXXXXX)"
  trap 'rm -rf "$stage"' EXIT

  for file in "${files[@]}"; do
    rule="${file#secrets/}"
    keys_expr="builtins.concatStringsSep \"\\n\" ((import ./secrets/secrets.nix).\"$rule\".publicKeys)"
    keys="$(nix eval --impure --raw --expr "$keys_expr")"
    recipients=()
    while IFS= read -r key; do
      [ -n "$key" ] && recipients+=("-r" "$key")
    done <<< "$keys"
    if ((${#recipients[@]} == 0)); then
      echo "no recipients configured for $rule" >&2
      exit 1
    fi

    staged="$stage/$(basename "$file")"
    age --decrypt --identity "$identity" -- "$file" \
      | age "${recipients[@]}" --output "$staged"
    age --decrypt --identity "$identity" -- "$staged" \
      | tar --list --gzip >/dev/null
  done

  for file in "${files[@]}"; do
    mv -- "$stage/$(basename "$file")" "$file"
  done

# --- Infrastructure ---

plan:
  terraform -chdir=infra plan

clean:
  terraform -chdir=infra destroy
