"""Manage remote Nix builds through the AWS, Terraform and Nix CLIs."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path

AWS_ROOT = Path(__file__).resolve().parents[1]


def run(*args, capture=True, **kwargs):
    return subprocess.run(
        args, check=True, text=True,
        stdout=subprocess.PIPE if capture else None, **kwargs,
    ).stdout


def aws(*args):
    return json.loads(run("aws", *args, "--output", "json"))


def target_name(value):
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", value):
        raise argparse.ArgumentTypeError("invalid package name")
    return value


def outputs():
    return {
        key: item["value"]
        for key, item in json.loads(run("terraform", "-chdir=infra", "output", "-json")).items()
    }


def credentials():
    # Renewal must work without Terraform state on an installed machine.
    data = aws("configure", "export-credentials", "--format", "process")
    for key in ("AccessKeyId", "SecretAccessKey"):
        if not isinstance(data.get(key), str) or not data[key]:
            raise ValueError("missing or invalid AWS credentials")
    fields = {
        "aws_access_key_id": data["AccessKeyId"],
        "aws_secret_access_key": data["SecretAccessKey"],
    }
    if data.get("SessionToken") is not None:
        fields["aws_session_token"] = data["SessionToken"]
    if any(not isinstance(value, str) or "\n" in value or "\r" in value for value in fields.values()):
        raise ValueError("invalid AWS credential value")
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "credentials"
        path.touch(mode=0o600)
        path.write_text("[default]\n" + "".join(f"{key} = {value}\n" for key, value in fields.items()))
        run("sudo", "install", "-d", "-m", "700", "/var/lib/nix/nixed-cache", capture=False)
        run("sudo", "install", "-m", "600", str(path), "/var/lib/nix/nixed-cache/credentials", capture=False)


def key_init(config):
    secret = config["signing_secret"]
    if aws("secretsmanager", "describe-secret", "--secret-id", secret).get("VersionIdsToStages"):
        raise ValueError("Signing key already exists; refusing to rotate it.")
    state = AWS_ROOT / ".state"
    state.mkdir(mode=0o700, exist_ok=True)
    state.chmod(0o700)
    with tempfile.TemporaryDirectory() as directory:
        private = Path(directory) / "private"
        public = Path(directory) / "public"
        run("nix-store", "--generate-binary-cache-key", "nixed-cache", str(private), str(public))
        aws("secretsmanager", "put-secret-value", "--secret-id", secret, "--secret-string", f"file://{private}")
        shutil.copyfile(public, state / "cache-public-key")
        run("aws", "s3", "cp", str(public), f"s3://{config['cache_bucket']}/cache-public-key")
        print(public.read_text(), end="")


def build(config, target):
    root = Path(run("git", "rev-parse", "--show-toplevel").strip())
    with tempfile.TemporaryDirectory() as directory:
        stage = Path(directory) / "source"
        stage.mkdir()
        # Include tracked local edits, never untracked credentials.
        tracked = run("git", "-C", str(root), "ls-files", "-z").split("\0")
        for name in filter(None, tracked):
            source = root / name
            if not source.exists() and not source.is_symlink():
                continue  # Locally deleted tracked file.
            destination = stage / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination, follow_symlinks=False)
        # Include the current runner even before this migration is committed.
        for name in ("buildspec.yml", "scripts/build.py", "scripts/install.sh"):
            destination = stage / "aws" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(AWS_ROOT / name, destination)
        expected = run("nix", "eval", "--raw", "--no-write-lock-file", f"path:{stage}#packages.x86_64-linux.{target}.outPath").strip()
        archive = Path(directory) / "source.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            for path in sorted(stage.rglob("*")):
                if path.is_symlink():
                    entry = zipfile.ZipInfo(path.relative_to(stage).as_posix())
                    entry.create_system = 3
                    entry.external_attr = path.lstat().st_mode << 16
                    zipped.writestr(entry, os.readlink(path))
                elif path.is_file():
                    zipped.write(path, path.relative_to(stage))
        key = f"sources/{uuid.uuid4()}.zip"
        run("aws", "s3", "cp", str(archive), f"s3://{config['source_bucket']}/{key}")
        envs = [
            {"name": "TARGET", "value": target, "type": "PLAINTEXT"},
            {"name": "EXPECTED_PATH", "value": expected, "type": "PLAINTEXT"},
        ]
        result = aws(
            "codebuild", "start-build", "--project-name", config["project"],
            "--source-location-override", f"{config['source_bucket']}/{key}",
            "--environment-variables-override", json.dumps(envs),
        )
        print(result["build"]["id"])


def get_build(build_id):
    builds = aws("codebuild", "batch-get-builds", "--ids", build_id).get("builds", [])
    if not builds:
        raise ValueError(f"Build not found: {build_id}")
    return builds[0]


def fetch(config, build_id):
    status = get_build(build_id)["buildStatus"]
    if status != "SUCCEEDED":
        raise ValueError(f"Build is {status}, not SUCCEEDED")
    result = json.loads(run("aws", "s3", "cp", f"s3://{config['cache_bucket']}/results/{build_id.replace(':', '_')}.json", "-"))
    target = target_name(result["target"])
    expected = run("nix", "eval", "--raw", "--no-write-lock-file", f"..#packages.x86_64-linux.{target}.outPath").strip()
    if result["path"] != expected:
        raise ValueError("Local package has changed since this build; refusing stale result")
    state = AWS_ROOT / ".state"
    state.mkdir(mode=0o700, exist_ok=True)
    public = state / "cache-public-key"
    if not public.is_file():
        run("aws", "s3", "cp", f"s3://{config['cache_bucket']}/cache-public-key", str(public))
    credentials()
    run(
        "sudo", "env", "AWS_SHARED_CREDENTIALS_FILE=/var/lib/nix/nixed-cache/credentials",
        "nix", "copy", "--from", f"s3://{config['cache_bucket']}?region={config['region']}",
        "--extra-trusted-public-keys", public.read_text().strip(), expected, capture=False,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("credentials", "key-init"):
        commands.add_parser(command)
    commands.add_parser("build").add_argument("target", type=target_name)
    for command in ("status", "logs", "fetch"):
        commands.add_parser(command).add_argument("id")
    args = parser.parse_args()
    os.chdir(AWS_ROOT)
    if args.command == "credentials":
        credentials()
    elif args.command in ("status", "logs"):
        result = get_build(args.id)
        logs = result.get("logs", {})
        if args.command == "status":
            print(json.dumps({"status": result["buildStatus"], "phase": result.get("currentPhase"), "logs": logs.get("deepLink")}, indent=2))
        else:
            if not logs.get("streamName") or not logs.get("groupName"):
                raise ValueError("Logs not available yet")
            run("aws", "logs", "tail", logs["groupName"], "--log-stream-names", logs["streamName"], "--since", "1d", "--follow", capture=False)
    else:
        config = outputs()
        os.environ["AWS_REGION"] = config["region"]
        if args.command == "key-init":
            key_init(config)
        elif args.command == "build":
            build(config, args.target)
        else:
            fetch(config, args.id)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        # Arguments/output may contain credentials; do not print them.
        print(f"{Path(error.cmd[0]).name} failed (exit {error.returncode})", file=sys.stderr)
        sys.exit(error.returncode)
    except (ValueError, KeyError, OSError, argparse.ArgumentTypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
