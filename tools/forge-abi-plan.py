"""CLI wrapper for generating Forge ABI export plans.

The Forge Compose lane calls this script before `forge inspect`. It keeps the
shell lane simple: parse the dapps root, delegate manifest/source validation to
`cam_abi_plan.py`, and write a TSV plan that the container can consume without
scraping JSON or guessing contract names.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


def fail(message: str) -> None:
    raise SystemExit(f"forge-abi-plan: {message}")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        fail("usage: forge-abi-plan.py <dapps-root> <plan-path>")

    helper = load_helper()
    try:
        rows = helper.build_abi_plan_rows(Path(argv[1]))
        helper.write_abi_plan(rows, Path(argv[2]))
    except helper.CamAbiPlanError as error:
        fail(str(error))

    print(f"forge-abi-plan: wrote {len(rows)} manifest-declared ABI target(s)")
    return 0


def load_helper():
    helper_path = Path(__file__).with_name("cam_abi_plan.py")
    sys.path.insert(0, str(helper_path.parent.parent))
    spec = importlib.util.spec_from_file_location("cam_abi_plan", helper_path)
    if spec is None or spec.loader is None:
        fail(f"could not load ABI plan helper: {helper_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
