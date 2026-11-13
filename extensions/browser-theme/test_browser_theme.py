import copy
import json
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("browser-theme.py")
HELPER = runpy.run_path(str(SCRIPT))
EXTENSION_ID = "mmfbflaekjfllceokohbkjafnljjgafl"


class ShortcutTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir="/tmp/opencode")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.profile = self.root / "Default"
        self.profile.mkdir()
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "commands": {
                        "_execute_action": {
                            "suggested_key": {"default": "Ctrl+O", "mac": "Command+O"}
                        }
                    },
                }
            )
        )
        self.prefs = {
            "unrelated": True,
            "extensions": {
                "settings": {EXTENSION_ID: {"path": "unchanged"}},
                "commands": {
                    "linux:Alt+E": {
                        "extension": EXTENSION_ID,
                        "command_name": "_execute_action",
                    },
                    "linux:Alt+Q": {
                        "extension": EXTENSION_ID,
                        "command_name": "010-open-popup-window",
                    },
                    "linux:Alt+X": {"extension": "other", "command_name": "other"},
                },
            },
        }
        self.preferences = self.profile / "Preferences"
        self.preferences.write_text(json.dumps(self.prefs))

    def test_platform_binding_and_preservation(self):
        for platform, key in (("linux", "linux:Ctrl+O"), ("darwin", "mac:Command+O")):
            with (
                self.subTest(platform=platform),
                patch.object(sys, "platform", platform),
            ):
                prefs = copy.deepcopy(self.prefs)
                HELPER["configure_tab_search"](prefs, self.manifest)
                commands = prefs["extensions"]["commands"]
                self.assertEqual(commands[key]["command_name"], "_execute_action")
                self.assertFalse(commands[key]["global"])
                if platform == "linux":
                    self.assertNotIn("linux:Alt+E", commands)
                self.assertEqual(
                    commands["linux:Alt+Q"],
                    self.prefs["extensions"]["commands"]["linux:Alt+Q"],
                )
                self.assertEqual(
                    commands["linux:Alt+X"],
                    self.prefs["extensions"]["commands"]["linux:Alt+X"],
                )
                self.assertTrue(prefs["unrelated"])
                settings = prefs["extensions"]["settings"][EXTENSION_ID]
                self.assertEqual(settings["path"], "unchanged")
                self.assertTrue(settings["commands"]["_execute_action"]["was_assigned"])
                before = copy.deepcopy(prefs)
                HELPER["configure_tab_search"](prefs, self.manifest)
                self.assertEqual(prefs, before)

    def test_uninstalled_extension_is_not_created(self):
        prefs = {"unrelated": True}
        self.assertFalse(HELPER["configure_tab_search"](prefs, self.manifest))
        self.assertEqual(prefs, {"unrelated": True})

    def test_manifest_change_replaces_previous_assignment(self):
        HELPER["configure_tab_search"](self.prefs, self.manifest)
        manifest = json.loads(self.manifest.read_text())
        manifest["commands"]["_execute_action"]["suggested_key"]["default"] = "Ctrl+P"
        self.manifest.write_text(json.dumps(manifest))
        HELPER["configure_tab_search"](self.prefs, self.manifest)
        commands = self.prefs["extensions"]["commands"]
        self.assertNotIn("linux:Ctrl+O", commands)
        self.assertEqual(commands["linux:Ctrl+P"]["extension"], EXTENSION_ID)

    def launch(self):
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--tab-search-manifest",
                str(self.manifest),
                "launch",
                "--",
                sys.executable,
                "-c",
                "import sys; sys.exit(17)",
                f"--user-data-dir={self.root}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_launch_without_palette_still_assigns_shortcut(self):
        with patch.dict("os.environ", {"XDG_CONFIG_HOME": str(self.root)}):
            result = self.launch()
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stderr, "")
        prefs = json.loads(self.preferences.read_text())
        self.assertIn("linux:Ctrl+O", prefs["extensions"]["commands"])

    def test_dangling_lock_leaves_preferences_untouched(self):
        (self.root / "SingletonLock").symlink_to("missing-host-123")
        before = self.preferences.read_bytes()
        result = self.launch()
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stderr, "")
        self.assertEqual(self.preferences.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
