"""Create explicit, reproducible plugin/core release archives (Python 3.9+)."""

import hashlib
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent


def archive(destination, entries):
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as bundle:
        for name, content in entries:
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = ZIP_DEFLATED
            bundle.writestr(info, content)
    with ZipFile(destination) as bundle:
        if bundle.testzip() is not None:
            raise ValueError("Archive integrity check failed")
        if bundle.namelist() != [name for name, _ in entries]:
            raise ValueError("Archive contains unexpected files")


def main():
    package = json.loads((ROOT / "package.json").read_text())
    manifest = json.loads((ROOT / "manifest.json").read_text())
    lock = json.loads((ROOT / "package-lock.json").read_text())
    versions = json.loads((ROOT / "versions.json").read_text())
    version = manifest["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Release version must be x.y.z")
    if package["version"] != version or lock["version"] != version:
        raise ValueError("Package and manifest versions differ")
    if lock["packages"][""]["version"] != version:
        raise ValueError("Lockfile root version differs")
    if versions.get(version) != manifest["minAppVersion"]:
        raise ValueError("versions.json minimum host version differs")
    if package["license"] != "MIT" or lock["packages"][""]["license"] != "MIT":
        raise ValueError("Package must declare MIT")
    policy = (ROOT / "src/numeric.ts").read_text()
    if f'engineVersion: "{version}"' not in policy:
        raise ValueError("Engine version differs")

    plugin_names = ["main.js", "manifest.json", "styles.css", "LICENSE",
                    "THIRD-PARTY-NOTICES.txt"]
    plugin = [(f"notecalc/{name}", (ROOT / name).read_bytes())
              for name in plugin_names]
    if any(not data for _, data in plugin):
        raise ValueError("Empty release input")
    license_text = (ROOT / "LICENSE").read_text()
    if not license_text.startswith("MIT License\n"):
        raise ValueError("Project license is missing")
    if "decimal.js" not in (ROOT / "THIRD-PARTY-NOTICES.txt").read_text():
        raise ValueError("Bundled dependency notice is missing")

    core_names = ["notecalc-core.mjs", "notecalc-core.mjs.map"]
    core = [(name, (ROOT / "dist" / name).read_bytes()) for name in core_names]
    core += [(name, (ROOT / name).read_bytes())
             for name in ["LICENSE", "THIRD-PARTY-NOTICES.txt"]]
    core.append(("README.md", (
        "# NoteCalc portable core\n\n"
        f"Version {version}; MIT License.\n\n"
        "Import calculateMarkdown from './notecalc-core.mjs'.\n"
        "Use feedback to display passive line annotations; do not write results "
        "into the input Markdown. Check result.nodeStates for partial errors.\n\n"
        "ES2022 JavaScript is required. No Obsidian or Node imports.\n"
        "For a browser, serve over HTTP and run computation in a Worker.\n"
        "This core does not connect to a live Obsidian/Agent session.\n\n"
        "https://github.com/HowieZhao95/notecalc\n"
    ).encode()))

    output = ROOT / "release" / version
    output.mkdir(parents=True, exist_ok=True)
    archive(output / f"notecalc-{version}.zip", plugin)
    archive(output / f"notecalc-core-{version}.zip", core)
    for name in plugin_names:
        (output / name).write_bytes((ROOT / name).read_bytes())
    artifacts = plugin_names + [f"notecalc-{version}.zip", f"notecalc-core-{version}.zip"]
    checksums = [f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}"
                 for name in sorted(artifacts)]
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
    print(json.dumps({"version": version, "directory": str(output),
                      "artifacts": artifacts + ["SHA256SUMS.txt"]}))


if __name__ == "__main__":
    main()
