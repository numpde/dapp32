"""Private-file round trip inside the measured release container namespace."""

import os
from pathlib import Path
import stat
import unittest


def private_round_trip(root: Path) -> None:
    """Read a private input; atomically replace and delete host-owned records."""
    assert stat.S_IMODE(root.stat().st_mode) == 0o700, "private directory mode changed"
    for name in ("input", "record", "remove"):
        info = (root / name).stat()
        assert stat.S_IMODE(info.st_mode) == 0o600, f"{name}: private file mode changed"
        assert (info.st_uid, info.st_gid) == (os.geteuid(), os.getegid()), f"{name}: not owned by measured process"
    assert (root / "input").read_text() == "private input\n"
    assert (root / "record").read_text() == "original record\n"
    descriptor = os.open(root / "replacement", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("replaced record\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(root / "replacement", root / "record")
    (root / "remove").unlink()
    assert (root / "record").read_text() == "replaced record\n"
    assert not (root / "remove").exists()


class PrivateMountTest(unittest.TestCase):
    def test_private_records_can_be_read_created_replaced_and_removed(self):
        private_round_trip(Path("/private"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
