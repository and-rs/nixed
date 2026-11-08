# Remote Nix package builds

Run from this directory inside the repository's `nix develop` shell. Uses the
existing `nix-dev` AWS profile, default region `us-west-2`. Nothing is deployed
by entering the shell. Only trusted source should ever run in this privileged
project: its role can publish signed binaries trusted by your machine.

`just check` runs offline CLI tests, ShellCheck, and Terraform checks after
`just init`. The first remote smoke test is still required; local tests cannot
verify CodeBuild's privileges, scratch capacity, IAM, or network access.

## First setup

1. `just auth`, `just init`, `just plan`. Inspect the compute size and costs.
   Add the new source files to Git before triggering builds; keep the generated
   `infra/.terraform.lock.hcl` in version control as well.
2. `just apply` provisions private source/cache buckets, CodeBuild, a service
   role, a Secrets Manager container, and logs. No static IAM access keys.
3. `just key-init` creates the signing key directly in Secrets Manager, outside
   Terraform state, and saves its public half in `.state/cache-public-key`.
4. `just build cache-smoke` tests Nix installation, sandboxing, signing, and S3
   access before paying for the CUDA build. Capture the returned build ID.
5. `just status ID`, `just logs ID`, then `just fetch ID`.
6. `just build obs-backgroundremoval` starts the real GPU-enabled build.

CodeBuild is billed while running; S3, Secrets Manager, and logs have separate
charges. The default large x86_64 environment has an eight-hour timeout and
one concurrent build. `just stop ID` cancels a job. No GPU is provisioned.
Container sandbox compatibility and sufficient disk must be verified by the
smoke test and actual package build; this setup never silently disables the
Nix sandbox. Adjust `compute_type` in ignored `infra/terraform.tfvars` if needed.

Source upload includes Git-tracked files with their current local edits, plus
the buildspec/build script. Untracked package files must be added to Git first.
Never track plaintext secrets: tracked source goes to a private upload bucket
and expires after seven days. The lockfile is not updated remotely. A manifest
is published only after the full output closure uploads successfully. Completed
built dependencies are signed/uploaded by a post-build hook, so later jobs can
reuse them after a failure. An upload error fails the build intentionally.

Terraform state is local and ignored: back it up securely or migrate it to
your own remote backend before sharing infrastructure management. Do not reuse
Louvre's state or artwork bucket. `terraform -chdir=infra destroy` requires empty
buckets; it will not silently delete your cache. No cache lifecycle is set:
arbitrarily expiring NARs would leave broken dependency closures.

## Local automatic substitution

`just fetch ID` checks that the successful build matches the current local
package, refreshes root-only AWS credentials from your active profile, and
fetches its signed closure. It does not build the package locally. It works
before the automatic cache configuration is enabled.

To enable substitution in normal NixOS rebuilds, set in your NixOS config:

```nix
nixed.binaryCache = {
  enable = true;
  url = "s3://BUCKET?region=us-west-2";
  publicKey = "nixed-cache:PUBLIC_KEY";
};
```

Get `BUCKET` from `terraform -chdir=infra output -raw cache_bucket`; use the
complete public key from `.state/cache-public-key`. Run `just credentials`
before rebuilding, then switch normally. Temporary AWS sessions expire: rerun
that command after renewing your AWS login. Credentials live outside the Nix
store at `/var/lib/nix/nixed-cache/credentials`, readable only by root. The daemon
does not inherit your interactive AWS profile. A dedicated read-only profile
is preferable for routine laptop fetching.

Readers need `s3:ListBucket` and `s3:GetBucketLocation` on the cache bucket and
`s3:GetObject` on its objects. The operator additionally needs to provision the
Terraform resources, upload source, start/read/stop builds, read logs, and create
the signing secret version. Never grant a reader access to the signing secret.

The cache contains runtime CUDA/TensorRT dependencies; keep it private and
review NVIDIA licensing before any redistribution. It saves local compilation
and scratch space, not the runtime closure's installed size.
