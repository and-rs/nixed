import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rules import (
    atomic_text,
    blocked_domains,
    browser_rules,
    deploy_extension,
    dns_config,
    main,
    refresh,
    validate,
)


def fixture():
    return {
        "blocked_domains": ["blocked.example"],
        "sources": {"proxies": {"domains": ["proxy.example"]}},
        "redirects": [
            {
                "hosts": ["reddit.com", "www.reddit.com"],
                "paths": ["/", "/r/popular"],
                "to": "https://www.reddit.com/user/example/m/dev",
            }
        ],
        "safe_search": {
            "google_domains": ["google.com", "www.google.com"],
            "google_ips": ["216.239.38.120", "2001:4860:4802:32::78"],
            "duckduckgo_ips": ["191.235.126.53"],
        },
    }


def source_snapshots():
    return [
        "\n".join(f"engine-{index}.example" for index in range(100)),
        json.dumps(
            {
                "instances": [
                    {"url": f"https://redlib-{index}.example"} for index in range(3)
                ]
            }
        ),
        "\n".join(
            f"google.{chr(97 + index // 26)}{chr(97 + index % 26)}"
            for index in range(100)
        ),
    ]


class RulesTests(unittest.TestCase):
    def test_shared_domains_and_ipv6_safesearch(self):
        rules = validate(fixture())
        self.assertEqual(blocked_domains(rules), ["blocked.example", "proxy.example"])
        config = dns_config(rules)
        self.assertIn("local=/blocked.example/\n", config)
        self.assertIn("local=/proxy.example/\n", config)
        self.assertIn(
            "host-record=www.google.com,216.239.38.120,2001:4860:4802:32::78", config
        )
        self.assertIn("host-record=duckduckgo.com,191.235.126.53", config)
        self.assertEqual(
            browser_rules(rules)[0]["condition"]["requestDomains"],
            blocked_domains(rules),
        )

    def test_redirect_boundaries(self):
        redirect = browser_rules(fixture())[1]
        pattern = re.compile(redirect["condition"]["regexFilter"])
        for url in (
            "https://reddit.com/",
            "https://www.reddit.com/?feed=home",
            "https://www.reddit.com/r/popular",
            "https://www.reddit.com/r/popular/?geo=US",
            "http://www.reddit.com/",
            "https://www.reddit.com:443/",
        ):
            self.assertRegex(url, pattern)
        for url in (
            "https://www.reddit.com/r/programming/",
            "https://www.reddit.com/user/example/m/dev",
            "https://www.reddit.com/r/popular/comments/123/title",
            "https://www.reddit.com.evil.example/",
            "https://evil.example/?https://reddit.com/",
        ):
            self.assertNotRegex(url, pattern)

    def test_invalid_domains_and_retained_services_rejected(self):
        for host in (
            "reddit.com",
            "instagram.com",
            "google.com",
            "duckduckgo.com",
            "com",
            "bad.example/\nserver=8.8.8.8",
            "-bad.example",
            "bad..example",
        ):
            with self.subTest(host=host):
                rules = fixture()
                rules["blocked_domains"].append(host)
                with self.assertRaises(ValueError):
                    validate(rules)

    def test_redirect_cycle_rejected(self):
        rules = fixture()
        rules["redirects"][0]["to"] = "https://www.reddit.com/"
        with self.assertRaises(ValueError):
            validate(rules)

    def test_invalid_safesearch_address_rejected(self):
        rules = fixture()
        rules["safe_search"]["duckduckgo_ips"] = ["127.0.0.1"]
        with self.assertRaises(ValueError):
            validate(rules)

    def test_extension_deployment_stable_private_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "manifest.json").write_text('{"manifest_version":3}')
            (source / "logic.js").write_text("// source")
            output = root / "extension"
            deploy_extension(fixture(), source, output)
            before = {path.name: path.read_bytes() for path in output.iterdir()}
            deploy_extension(fixture(), source, output)
            self.assertEqual(
                before, {path.name: path.read_bytes() for path in output.iterdir()}
            )
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((output / "config.js").stat().st_mode & 0o777, 0o600)
            self.assertEqual(
                json.loads((output / "rules.json").read_text()),
                browser_rules(fixture()),
            )

    def test_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "config"
            atomic_text(output, "old")
            atomic_text(output, "new")
            self.assertEqual(output.read_text(), "new")
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_late_refresh_failure_preserves_encrypted_source(self):
        with tempfile.TemporaryDirectory() as directory:
            encrypted = Path(directory) / "browsing.age"
            original = b"previous encrypted rules"
            encrypted.write_bytes(original)
            args = [
                "rules.py",
                "--encrypted",
                str(encrypted),
                "--extension-source",
                "/unused",
                "refresh",
                "--recipient",
                "test-recipient",
            ]
            with (
                patch("sys.argv", args),
                patch(
                    "rules.subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        [], 0, stdout=json.dumps(fixture()).encode()
                    ),
                ) as decrypt,
                patch(
                    "rules.download",
                    side_effect=[
                        *source_snapshots()[:2],
                        OSError("Google domain download failed"),
                    ],
                ) as download,
                self.assertRaises(OSError),
            ):
                main()
            self.assertEqual(download.call_count, 3)
            decrypt.assert_called_once()
            self.assertEqual(encrypted.read_bytes(), original)

    def test_refresh_preserves_reviewed_search_engine_blocks(self):
        rules = fixture()
        reviewed = {"domains": ["search.example"], "updated": "2026-11-17"}
        rules["sources"]["reviewed_search"] = reviewed
        with (
            patch("rules.download", side_effect=source_snapshots()),
            patch("rules.safe_addresses", return_value=["1.1.1.3"]),
        ):
            updated = refresh(rules)
        self.assertEqual(updated["sources"]["reviewed_search"], reviewed)
        self.assertIn("local=/search.example/\n", dns_config(updated))
        self.assertIn(
            "search.example", browser_rules(updated)[0]["condition"]["requestDomains"]
        )

    def test_decryption_failure_preserves_existing_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "extension"
            output.mkdir()
            manifest = output / "manifest.json"
            manifest.write_text("previous working extension")
            args = [
                "rules.py",
                "--encrypted",
                "/unused",
                "--extension-source",
                "/unused",
                "extension",
                "--output",
                str(output),
            ]
            with (
                patch("sys.argv", args),
                patch(
                    "rules.subprocess.run",
                    side_effect=subprocess.CalledProcessError(1, ["age"]),
                ),
                self.assertRaises(subprocess.CalledProcessError),
            ):
                main()
            self.assertEqual(manifest.read_text(), "previous working extension")

    def test_dns_validation_failure_preserves_existing_config(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "dnsmasq.conf"
            output.write_text("previous working config")
            args = [
                "rules.py",
                "--encrypted",
                "/unused",
                "--extension-source",
                "/unused",
                "dns",
                "--output",
                str(output),
            ]
            responses = [
                subprocess.CompletedProcess(
                    [], 0, stdout=json.dumps(fixture()).encode()
                ),
                subprocess.CalledProcessError(1, ["dnsmasq"]),
            ]
            with (
                patch("sys.argv", args),
                patch("rules.subprocess.run", side_effect=responses),
                self.assertRaises(subprocess.CalledProcessError),
            ):
                main()
            self.assertEqual(output.read_text(), "previous working config")


if __name__ == "__main__":
    unittest.main()
