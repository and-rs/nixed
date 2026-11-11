"""Build, sign and publish a Nix package inside CodeBuild."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def run(*args, capture=False, **kwargs):
    if capture:
        kwargs["stdout"] = subprocess.PIPE
    return subprocess.run(args, check=True, text=True, **kwargs).stdout


def cache_url():
    region = os.environ.get("AWS_REGION") or os.environ["AWS_DEFAULT_REGION"]
    return f"s3://{os.environ['CACHE_BUCKET']}?region={region}&multipart-upload=1&compression=zstd&compression-level=3"


def hook():
    stage = "initialization"
    status = 0
    drv = os.environ.get("DRV_PATH", "unknown")
    try:
        paths = os.environ["OUT_PATHS"].split()
        if not paths:
            raise ValueError("No output paths supplied")
        print(f"[cache-hook] start drv={drv} outputs={' '.join(paths)}", file=sys.stderr, flush=True)
        stage = "signing"
        run("nix", "store", "sign", "--key-file", os.environ["CACHE_SIGNING_KEY"], *paths)
        stage = "upload"
        run("nix", "copy", "--to", cache_url(), *paths)
        stage = "complete"
    except subprocess.CalledProcessError as error:
        status = error.returncode
        raise
    except (ValueError, KeyError, OSError):
        status = 1
        raise
    finally:
        print(f"[cache-hook] stage={stage} exit={status} drv={drv}", file=sys.stderr, flush=True)


def build():
    target = os.environ["TARGET"]
    expected = os.environ["EXPECTED_PATH"]
    cache = cache_url()
    with tempfile.TemporaryDirectory(prefix="nixed-build-") as directory:
        directory = Path(directory)
        key = directory / "cache-key"
        key.touch(mode=0o600)
        with key.open("w") as output:
            run("aws", "secretsmanager", "get-secret-value", "--secret-id", os.environ["SIGNING_SECRET"], "--query", "SecretString", "--output", "text", stdout=output)
        with key.open() as source:
            public = run("nix", "key", "convert-secret-to-public", capture=True, stdin=source).strip()
        with Path("/etc/nix/nix.conf").open("a") as config:
            config.write(f"extra-substituters = {cache}\nextra-trusted-public-keys = {public}\n")
        os.environ["CACHE_SIGNING_KEY"] = str(key)
        hook_path = directory / "cache-hook"
        hook_path.write_text(
            f"#!{sys.executable}\nimport runpy, sys\nsys.argv = [{str(Path(__file__).resolve())!r}, 'hook']\n"
            f"runpy.run_path({str(Path(__file__).resolve())!r}, run_name='__main__')\n"
        )
        hook_path.chmod(0o700)
        package = f"path:.#packages.x86_64-linux.{target}"
        actual = run("nix", "eval", "--raw", "--no-write-lock-file", f"{package}.outPath", capture=True).strip()
        if actual != expected:
            raise ValueError("Source snapshot does not match expected output")
        run("df", "-h", "/nix", str(directory))
        run("nix", "build", "--print-build-logs", "--no-write-lock-file", "--out-link", str(directory / "result"), "--option", "post-build-hook", str(hook_path), package)
        run("nix", "store", "sign", "--recursive", "--key-file", str(key), actual)
        run("nix", "copy", "--to", cache, actual)
        result = directory / "result.json"
        build_id = os.environ["CODEBUILD_BUILD_ID"]
        result.write_text(json.dumps({"target": target, "path": actual, "build": build_id}))
        run("aws", "s3", "cp", str(result), f"s3://{os.environ['CACHE_BUCKET']}/results/{build_id.replace(':', '_')}.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "hook"))
    args = parser.parse_args()
    os.environ["PATH"] = f"/root/.nix-profile/bin:{os.environ['PATH']}"
    try:
        if args.command == "hook":
            # Nix expects hook diagnostics on stderr, never stdout.
            os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
            hook()
        else:
            build()
    except subprocess.CalledProcessError as error:
        print(f"{Path(error.cmd[0]).name} failed (exit {error.returncode})", file=sys.stderr)
        sys.exit(error.returncode)
    except (ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
