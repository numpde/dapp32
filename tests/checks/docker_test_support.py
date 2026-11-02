"""Provide a selected endpoint to tests that replace Docker with a fake."""

import os
from pathlib import Path
from unittest.mock import patch

from .common import ROOT


ENDPOINT = "unix:///tmp/context-fixture.sock"


def docker_environment_fixture():
    selected = patch.dict(os.environ, {"CAM_DOCKER_ENDPOINT": ENDPOINT, "TEST_EXPECTED_DOCKER_ENDPOINT": ENDPOINT})
    return selected.start, selected.stop


def make_environment(environment: dict[str, str], *, delegate: Path | None = None) -> dict[str, str]:
    result = environment | {
        "PATH": f"{ROOT / 'tests/fixtures/docker-context'}:{environment['PATH']}",
        "TRACE": os.devnull, "ENDPOINT": ENDPOINT, "FAKE_MODE": "",
    }
    if delegate is not None:
        result["DOCKER_DELEGATE"] = str(delegate)
    return result
