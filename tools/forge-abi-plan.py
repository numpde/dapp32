"""CLI wrapper for generating Forge ABI export plans.

The Forge Compose lane calls this script before `forge inspect`. It keeps the
shell lane simple: parse the dapps root, delegate manifest/source validation to
`cam_abi_plan.py`, and write a TSV plan that the container can consume without
scraping JSON or guessing contract names.
"""

from __future__ import annotations

from pathlib import Path
import sys


def fail(message: str) -> None:
    raise SystemExit(f"forge-abi-plan: {message}")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        fail("usage: forge-abi-plan.py <dapps-root> <plan-path>")

    # Python isolated mode excludes the checkout from its import path.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from tools.cam_abi_plan import CamAbiPlanError, build_abi_plan_rows, write_abi_plan

    try:
        rows = build_abi_plan_rows(Path(argv[1]))
        write_abi_plan(rows, Path(argv[2]))
    except CamAbiPlanError as error:
        fail(str(error))

    print(f"forge-abi-plan: wrote {len(rows)} manifest-declared ABI target(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
