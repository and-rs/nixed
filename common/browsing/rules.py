"""Deploy encrypted browsing rules without putting plaintext in the Nix store."""

import argparse
import ipaddress
import json
import os
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def domain(value):
    if not isinstance(value, str) or len(value) > 253:
        raise ValueError("Invalid domain")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", value):
        raise ValueError("Invalid domain")
    if "." not in value or any(
        not label or len(label) > 63 or label.startswith("-") or label.endswith("-")
        for label in value.split(".")
    ):
        raise ValueError("Invalid domain")
    return value


def blocked_domains(rules):
    return sorted(
        set(rules["blocked_domains"])
        | {
            host
            for source in rules.get("sources", {}).values()
            for host in source["domains"]
        }
    )


def validate(rules):
    blocked = blocked_domains(rules)
    if not blocked:
        raise ValueError("A nonempty blocked_domains list is required")
    for value in blocked:
        domain(value)
    if len(blocked) > 20000:
        raise ValueError("Unexpectedly large blocklist; review the sources")
    # These are deliberate retained services, not runtime bypass controls.
    for retained in (
        "reddit.com",
        "www.reddit.com",
        "instagram.com",
        "google.com",
        "duckduckgo.com",
    ):
        if any(retained == item or retained.endswith("." + item) for item in blocked):
            raise ValueError("A retained service is blocked")
    for redirect in rules["redirects"]:
        if not redirect["hosts"] or not redirect["paths"]:
            raise ValueError("Empty redirect")
        for host in redirect["hosts"]:
            domain(host)
            if any(host == item or host.endswith("." + item) for item in blocked):
                raise ValueError("A redirect source is blocked")
        for path in redirect["paths"]:
            if not re.fullmatch(r"/[a-zA-Z0-9/_-]*", path):
                raise ValueError("Redirect paths must be literal paths")
        target = urlsplit(redirect["to"])
        if (
            target.scheme != "https"
            or not target.hostname
            or target.username
            or target.password
        ):
            raise ValueError("Redirect destinations must be HTTPS URLs")
        domain(target.hostname)
        if any(
            target.hostname == item or target.hostname.endswith("." + item)
            for item in blocked
        ):
            raise ValueError("A redirect destination is blocked")
        for other in rules["redirects"]:
            if target.hostname in other["hosts"] and target.path.rstrip("/") in (
                path.rstrip("/") for path in other["paths"]
            ):
                raise ValueError("Redirect destinations must not redirect again")
    safe = rules["safe_search"]
    for host in safe["google_domains"]:
        domain(host)
        if not re.fullmatch(r"(?:(?:www|images|encrypted)\.)?google\.[a-z.]+", host):
            raise ValueError("Unexpected Google SafeSearch hostname")
        if any(host == item or host.endswith("." + item) for item in blocked):
            raise ValueError("A SafeSearch hostname is blocked")
    for key in ("google_ips", "duckduckgo_ips"):
        if not safe[key] or not any(
            ipaddress.ip_address(ip).version == 4 for ip in safe[key]
        ):
            raise ValueError("SafeSearch needs IPv4 addresses")
        for ip in safe[key]:
            if not ipaddress.ip_address(ip).is_global:
                raise ValueError("SafeSearch requires public IP addresses")
    return rules


def dns_config(rules):
    lines = ["# Generated from encrypted browsing rules; do not edit."]
    # Empty server addresses return NXDOMAIN, including for subdomains and AAAA.
    lines += [f"local=/{host}/" for host in blocked_domains(rules)]
    safe = rules["safe_search"]
    for host in safe["google_domains"]:
        lines.append(f"host-record={host},{','.join(safe['google_ips'])}")
    for host in (
        "duckduckgo.com",
        "www.duckduckgo.com",
        "html.duckduckgo.com",
        "lite.duckduckgo.com",
        "start.duckduckgo.com",
        "safe.duckduckgo.com",
    ):
        lines.append(f"host-record={host},{','.join(safe['duckduckgo_ips'])}")
    return "\n".join(lines) + "\n"


def browser_rules(rules):
    result = [
        {
            "id": 1,
            "priority": 1,
            "action": {"type": "block"},
            "condition": {
                "requestDomains": blocked_domains(rules),
                "resourceTypes": ["main_frame", "sub_frame"],
            },
        }
    ]
    for redirect in rules["redirects"]:
        hosts = "|".join(re.escape(host) for host in redirect["hosts"])
        paths = "|".join(
            re.escape(path.rstrip("/")) + ("/?" if path.rstrip("/") else "/")
            for path in redirect["paths"]
        )
        result.append(
            {
                "id": len(result) + 1,
                "priority": 2,
                "action": {"type": "redirect", "redirect": {"url": redirect["to"]}},
                "condition": {
                    "regexFilter": f"^https?://({hosts})(:[0-9]+)?({paths})([?#].*)?$",
                    "resourceTypes": ["main_frame"],
                },
            }
        )
    return result


def atomic_text(path, text, mode=0o600):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", dir=path.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def deploy_extension(rules, source, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    # Keep the unpacked extension at a stable path so Chromium keeps its identity.
    # Publish its manifest last; a failed decryption/validation never changes it.
    output.mkdir(mode=0o700, exist_ok=True)
    for path in source.iterdir():
        if path.name != "manifest.json":
            atomic_text(output / path.name, path.read_text())
    atomic_text(output / "rules.json", json.dumps(browser_rules(rules)))
    atomic_text(
        output / "config.js",
        "globalThis.browsingConfig = "
        + json.dumps({"redirects": rules["redirects"]})
        + ";\n",
    )
    atomic_text(output / "manifest.json", (source / "manifest.json").read_text())


SEARCH_SOURCE = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/nosafesearch-onlydomains.txt"
REDLIB_SOURCE = (
    "https://raw.githubusercontent.com/redlib-org/redlib-instances/main/instances.json"
)
GOOGLE_SOURCE = "https://www.google.com/supported_domains"


def download(url):
    with urlopen(
        Request(url, headers={"User-Agent": "browsing-rules/1.0"}), timeout=30
    ) as response:
        return response.read().decode()


def safe_addresses(host):
    result = []
    for record, code in (("A", 1), ("AAAA", 28)):
        url = f"https://cloudflare-dns.com/dns-query?name={host}&type={record}"
        request = Request(url, headers={"Accept": "application/dns-json"})
        with urlopen(request, timeout=30) as response:
            answer = json.load(response)
        if answer["Status"] != 0:
            raise ValueError("SafeSearch DNS lookup failed")
        result += [
            item["data"] for item in answer.get("Answer", []) if item["type"] == code
        ]
    return result


def refresh(rules):
    """Refresh explicit snapshots only, never fetch lists during boot or launch."""
    date = datetime.now(UTC).date().isoformat()
    engines = [
        line.strip()
        for line in download(SEARCH_SOURCE).splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    instances = json.loads(download(REDLIB_SOURCE))["instances"]
    redlib = [urlsplit(item["url"]).hostname for item in instances if item.get("url")]
    if len(engines) < 100 or len(redlib) < 3:
        raise ValueError("Unexpectedly small source snapshot")
    rules.setdefault("sources", {}).update(
        {
            "unsupported_search": {
                "url": SEARCH_SOURCE,
                "updated": date,
                "domains": sorted(set(engines)),
            },
            "redlib": {
                "url": REDLIB_SOURCE,
                "updated": date,
                "domains": sorted(set(redlib)),
            },
        }
    )
    google = [
        line.strip().lstrip(".")
        for line in download(GOOGLE_SOURCE).splitlines()
        if line.strip()
    ]
    if len(google) < 100:
        raise ValueError("Unexpected Google domain list")
    rules["safe_search"] = {
        "updated": date,
        "google_domains": sorted(
            {
                host
                for item in google
                for host in (item, "www." + item, "images." + item)
            }
            | {"encrypted.google.com"}
        ),
        "google_ips": safe_addresses("forcesafesearch.google.com"),
        "duckduckgo_ips": safe_addresses("safe.duckduckgo.com"),
    }
    return validate(rules)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encrypted", type=Path, required=True)
    parser.add_argument("--extension-source", type=Path, required=True)
    parser.add_argument("mode", choices=("dns", "extension", "refresh"))
    parser.add_argument("--identity", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--recipient", action="append", default=[])
    args = parser.parse_args()
    darwin = os.uname().sysname == "Darwin"
    identity = args.identity or Path.home() / ".ssh" / (
        "agenix-darwin" if darwin else "agenix"
    )
    plaintext = subprocess.run(
        ["age", "--decrypt", "--identity", str(identity), str(args.encrypted)],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    rules = validate(json.loads(plaintext))
    if args.mode == "refresh":
        if not args.recipient:
            parser.error("refresh requires encryption recipients")
        updated = refresh(rules)
        recipients = [flag for key in args.recipient for flag in ("--recipient", key)]
        ciphertext = subprocess.run(
            ["age", "--encrypt", "--armor", *recipients],
            input=(json.dumps(updated, indent=2) + "\n").encode(),
            check=True,
            stdout=subprocess.PIPE,
        ).stdout
        # Verify the new ciphertext with this device before replacing the source.
        subprocess.run(
            ["age", "--decrypt", "--identity", str(identity)],
            input=ciphertext,
            stdout=subprocess.DEVNULL,
            check=True,
        )
        atomic_text(args.encrypted, ciphertext.decode())
    elif args.mode == "dns":
        if args.output is None:
            parser.error("dns requires --output")
        text = dns_config(rules)
        # Validate before replacing the last working DNS rules.
        subprocess.run(
            ["dnsmasq", "--test", "--conf-file=-"], input=text.encode(), check=True
        )
        atomic_text(args.output, text)
    else:
        root = (
            Path.home() / "Library/Application Support"
            if darwin
            else Path(
                os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))
            )
        )
        output = args.output or root / "browsing/extension"
        deploy_extension(rules, args.extension_source, output)
        print(output)


if __name__ == "__main__":
    main()
