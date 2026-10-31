import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
output = root.parent / f"xjtu-learning-tools-{version}.zip"
entries = [root / "manifest.json", root / "background.js"]
for directory in ("assets", "content", "popup", "manager", "shared"):
    entries.extend(path for path in (root / directory).rglob("*") if path.is_file())

with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(entries):
        archive.write(path, path.relative_to(root).as_posix())

with ZipFile(output) as archive:
    invalid = archive.testzip()
    if invalid:
        raise RuntimeError(f"压缩包校验失败：{invalid}")
    print(f"{output} | {output.stat().st_size} bytes | {len(archive.namelist())} files")
