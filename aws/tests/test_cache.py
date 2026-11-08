"""Offline CLI contract tests; no AWS calls or real builds."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


class CacheCLI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.aws = self.root / "aws"
        (self.aws / "scripts").mkdir(parents=True)
        (self.aws / "infra").mkdir()
        source = Path(__file__).resolve().parents[1]
        shutil.copy(source / "scripts/cache.sh", self.aws / "scripts")
        shutil.copy(source / "scripts/build.sh", self.aws / "scripts")
        shutil.copy(source / "buildspec.yml", self.aws)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls"
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", CALL_LOG=str(self.log))
        self.mock("terraform", "printf '%s' '{\"region\":{\"value\":\"us-west-2\"},\"cache_bucket\":{\"value\":\"cache\"},\"source_bucket\":{\"value\":\"source\"},\"project\":{\"value\":\"nixed-build\"}}'")
        self.mock("sudo", 'echo unexpected-sudo >> "$CALL_LOG"; exit 99')
        self.mock("nix", 'echo /nix/store/expected-package')

    def mock(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body + "\n")
        path.chmod(0o755)

    def run_cli(self, *args):
        return subprocess.run(
            ["bash", "scripts/cache.sh", *args], cwd=self.aws,
            env=self.env, capture_output=True, text=True,
        )

    def test_failed_build_is_not_fetched(self):
        self.mock("aws", "echo FAILED")
        result = self.run_cli("fetch", "project:123")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not SUCCEEDED", result.stderr)
        self.assertFalse(self.log.exists())

    def test_stale_build_is_not_fetched(self):
        manifest = json.dumps({"target": "obs-backgroundremoval", "path": "/nix/store/old-package"})
        self.mock("aws", f"if [[ $1 == codebuild ]]; then echo SUCCEEDED; else printf '%s' '{manifest}'; fi")
        result = self.run_cli("fetch", "project:123")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing stale result", result.stderr)
        self.assertFalse(self.log.exists())

    def test_failed_credentials_do_not_install_empty_file(self):
        self.mock("aws", "exit 1")
        result = self.run_cli("credentials")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_invalid_target_never_starts_build(self):
        self.mock("aws", 'echo unexpected-aws >> "$CALL_LOG"; exit 99')
        result = self.run_cli("build", "../secrets")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_build_uploads_tracked_edits_not_untracked_secrets(self):
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        flake = self.root / "flake.nix"
        flake.write_text("original")
        subprocess.run(["git", "-C", str(self.root), "add", "flake.nix"], check=True)
        flake.write_text("edited")
        (self.root / ".env").write_text("SECRET=do-not-upload")
        uploaded = self.root / "uploaded.zip"
        self.env["UPLOAD"] = str(uploaded)
        self.mock("aws", '''
if [[ $1 == s3 ]]; then cp "$3" "$UPLOAD"
else echo nixed-build:123
fi''')
        result = self.run_cli("build", "obs-backgroundremoval")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("nixed-build:123", result.stdout)
        with zipfile.ZipFile(uploaded) as archive:
            self.assertEqual(archive.read("flake.nix"), b"edited")
            self.assertIn("aws/scripts/build.sh", archive.namelist())
            self.assertNotIn(".env", archive.namelist())

    def test_successful_fetch_preserves_signature_check(self):
        manifest = json.dumps({"target": "obs-backgroundremoval", "path": "/nix/store/expected-package"})
        self.mock("aws", f"""
if [[ $1 == codebuild ]]; then echo SUCCEEDED
elif [[ $1 == configure ]]; then echo '{{"AccessKeyId":"key","SecretAccessKey":"secret","SessionToken":"token"}}'
else printf '%s' '{manifest}'
fi""")
        state = self.aws / ".state"
        state.mkdir()
        (state / "cache-public-key").write_text("nixed-cache:public")
        self.mock("sudo", 'printf "%s\\n" "$*" >> "$CALL_LOG"')
        result = self.run_cli("fetch", "project:123")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.log.read_text()
        self.assertIn("--extra-trusted-public-keys nixed-cache:public", calls)
        self.assertIn("/nix/store/expected-package", calls)
        self.assertNotIn("--no-check-sigs", calls)


if __name__ == "__main__":
    unittest.main()
