"""Create configured viewer-update user units without replacing operator files.

The checked-in units own scheduling and service policy. This host-only creator
substitutes this checkout and explicit runtime settings, then reloads systemd.
It never connects to Docker, enables a unit, or starts one.
"""

import ipaddress
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
SERVICE = "cam-viewer-update.service"
TIMER = "cam-viewer-update.timer"


def printable(value: str, label: str) -> str:
    """Reject empty values and line/control injection before rendering unit text."""
    if not value or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{label} must be nonempty and contain no control characters")
    return value


def exec_argument(value: str) -> str:
    """Quote one ExecStart argument, keeping specifiers and environment text literal."""
    printable(value, "ExecStart argument")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%").replace("$", "$$") + '"'


def service_text(context: str) -> str:
    """Configure the template while leaving its fixed service policy authoritative."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", context):
        raise ValueError("DOCKER_CONTEXT must name a local context; no engine connection is made during creation")
    settings = {}
    for name in ("VIEWER_COMPOSE_PROJECT_NAME", "VIEWER_BIND_HOST", "VIEWER_PORT", "VIEWER_PUBLIC_ORIGIN"):
        if name not in os.environ:
            raise ValueError(f"Supply {name} explicitly when creating viewer update units")
        settings[name] = printable(os.environ[name], name)
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", settings["VIEWER_COMPOSE_PROJECT_NAME"]):
        raise ValueError("VIEWER_COMPOSE_PROJECT_NAME must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores or hyphens")
    try:
        ipaddress.ip_address(settings["VIEWER_BIND_HOST"])
    except ValueError as error:
        raise ValueError("VIEWER_BIND_HOST must be an IPv4 or IPv6 interface address") from error
    port = settings["VIEWER_PORT"]
    if not re.fullmatch(r"[1-9][0-9]{3,4}", port) or not 1024 <= int(port) <= 65535:
        raise ValueError("VIEWER_PORT must be an integer from 1024 to 65535")
    origin = urlsplit(settings["VIEWER_PUBLIC_ORIGIN"])
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.path or origin.query or origin.fragment or any(character.isspace() for character in origin.netloc)):
        raise ValueError("VIEWER_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment")
    if origin.port is not None and not 1 <= origin.port <= 65535:
        raise ValueError("VIEWER_PUBLIC_ORIGIN contains an invalid port")

    directory = printable(str(ROOT), "Checkout path")
    replacements = {
        # This property takes a literal path, not ExecStart argument quoting.
        # The slash also protects a final space or backslash from INI trimming
        # or line continuation. Only percent specifiers need escaping here.
        "@WORKING_DIRECTORY@": (directory + "/").replace("%", "%%"),
        "@DOCKER_CONTEXT@": exec_argument("DOCKER_CONTEXT=" + context),
    }
    for name, value in settings.items():
        replacements["@" + name + "@"] = exec_argument(name + "=" + value)
    template = (ROOT / "tools/systemd" / SERVICE).read_text(encoding="utf-8")
    for marker in replacements:
        if template.count(marker) != 1:
            raise ValueError(f"The service template must contain exactly one {marker}; no unit files were created")
    # Inserted paths can contain marker-shaped text. Never interpret it again.
    pattern = "|".join(re.escape(marker) for marker in replacements)
    return re.sub(pattern, lambda match: replacements[match[0]], template)


def create(context: str) -> None:
    """Create both files exclusively, then reload; reload failure retains the files.

    Preflight both names before writing. Exclusive opens also handle a second
    creator racing that preflight; partial failure checks file identity before
    removing this attempt's outputs.
    """
    if os.geteuid() == 0:
        raise ValueError("Create viewer update units as the non-root deployment user; viewer/update refuses root execution")
    service = service_text(context)
    timer = (ROOT / "tools/systemd" / TIMER).read_text(encoding="utf-8")
    # silent-defaults: allow-default -- XDG specifies ~/.config when XDG_CONFIG_HOME is absent or empty.
    config_home = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    printable(config_home, "XDG_CONFIG_HOME")
    if not Path(config_home).is_absolute():
        raise ValueError("XDG_CONFIG_HOME must be an absolute directory")
    directory = Path(config_home) / "systemd/user"
    if directory.resolve().is_relative_to(ROOT):
        raise ValueError("User unit files contain host settings and must be created outside the repository")
    outputs = ((directory / SERVICE, service), (directory / TIMER, timer))
    for path, _ in outputs:
        if os.path.lexists(path):
            raise FileExistsError(f"Refusing to replace existing unit file {path}; neither unit was written or activated")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    created = []
    try:
        for path, content in outputs:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append((path, os.fstat(descriptor)))
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(content)
    except OSError:
        for path, identity in reversed(created):
            try:
                current = path.lstat()
                if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                    path.unlink()
            except FileNotFoundError:
                continue
            except OSError as cleanup:
                print(f"Could not remove partially created unit {path}: {cleanup}", file=sys.stderr)
        raise
    try:
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Both unit files were created, but systemd reload could not be confirmed. Retry systemctl --user daemon-reload; no unit was enabled or started") from error
    print("Created configured viewer update user units and reloaded systemd; neither unit was enabled or started.")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Use make viewer/update/unit-files/create with explicit viewer settings")
        create(sys.argv[1])
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Cannot create viewer update unit files: {error}", file=sys.stderr)
        if error.__cause__ is not None:
            print(f"Cause: {error.__cause__}", file=sys.stderr)
        sys.exit(1)
