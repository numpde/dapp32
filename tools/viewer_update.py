"""Update one existing viewer from deploy/viewer without deployment state files.

Docker owns release identity and the current image. This controller is loaded
before changing its source checkout; child Make processes use the new source.
Runtime Compose changes require an operator migration so image rollback can
reuse the same configuration without saving configuration snapshots.
"""

import ast
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://github.com/numpde/dapp32"
REVISION = re.compile(r"[0-9a-f]{40}")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}")
# A release selected after isolated migration must keep this updater contract.
ISOLATED_VIEWER_UPDATER = True


def execute(args: list[str], *, timeout: float, capture: bool) -> str:
    """Wait for the command group to stop before another operation may start.

    Make's children can outlive Make on cancellation. Give the entire group
    time for EXIT teardown, then kill survivors before permitting rollback.
    A new session also keeps outer timer cancellation under this owner's care.
    """
    process = subprocess.Popen(args, cwd=ROOT, start_new_session=True, text=True,
                               stdout=subprocess.PIPE if capture else None)
    try:
        output, _ = process.communicate(timeout=timeout)
    except (subprocess.TimeoutExpired, TimeoutError, KeyboardInterrupt):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        # silent-defaults: allow-exception-fallback -- The group may exit between cancellation and signaling; it already satisfies termination.
        except ProcessLookupError:
            pass
        end = time.monotonic() + 60
        while time.monotonic() < end:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        # silent-defaults: allow-exception-fallback -- A fully exited group needs no forced termination.
        except ProcessLookupError:
            pass
        process.communicate()
        raise
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, args)
    if capture:
        return output.strip()
    return ""


# silent-defaults: allow-default -- Engine and Git probes have a fixed two-minute operational deadline, not a substituted operator input.
def run(*args: str, timeout: int = 120) -> str:
    """Run one bounded operator command, preserving its stderr on failure."""
    return execute(list(args), timeout=timeout, capture=True)


def docker(*args: str) -> str:
    return run("docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], *args)


def inspect(kind: str, identifier: str) -> dict:
    """Read one exact engine object; malformed responses cannot authorize effects."""
    objects = json.loads(docker(kind, "inspect", identifier))
    if not isinstance(objects, list) or len(objects) != 1 or not isinstance(objects[0], dict):
        raise ValueError(f"Cannot inspect exactly one {kind}: {identifier}")
    return objects[0]


def image_revision(image: dict, project: str) -> str:
    """Admit clean viewer images built for this project, never nginx's labels."""
    labels = image["Config"]["Labels"]
    if not isinstance(labels, dict):
        raise ValueError("Viewer image does not contain identity labels")
    revision = labels.get("org.opencontainers.image.revision")
    if (labels.get("org.opencontainers.image.source") != SOURCE
            or labels.get("com.cam.role") != "viewer"
            or labels.get("com.cam.viewer.project") != project
            or labels.get("com.cam.viewer.modified") != "false"
            or not isinstance(revision, str) or not REVISION.fullmatch(revision)):
        raise ValueError("Viewer image lacks clean viewer-owned identity; establish a labeled release with the manual build/up workflow first")
    return revision


def live_viewer(project: str, *, allow_missing: bool) -> dict | None:
    """Inspect the sole viewer, allowing absence only for isolated recovery."""
    containers = docker("container", "ls", "--all", "--quiet", "--no-trunc",
                        "--filter", f"label=com.docker.compose.project={project}",
                        "--filter", "label=com.docker.compose.service=viewer",
                        "--filter", "label=com.docker.compose.oneoff=False").splitlines()
    if not containers and allow_missing:
        return None
    if len(containers) != 1:
        raise ValueError(f"Expected one existing viewer in {project}; found {len(containers)}. Use manual build/up for initial installation")
    container = inspect("container", containers[0])
    identifier = container.get("Image")
    if not isinstance(identifier, str) or not IMAGE_ID.fullmatch(identifier):
        raise ValueError("Cannot determine the existing viewer's immutable image ID")
    return container


def healthy(container: dict) -> bool:
    state = container.get("State")
    if not isinstance(state, dict) or not isinstance(state.get("Running"), bool):
        raise ValueError("Cannot determine viewer container health")
    health = state.get("Health")
    return state["Running"] is True and isinstance(health, dict) and health.get("Status") == "healthy"


class EntryScript(HTMLParser):
    """Find the Vite entry module; remote or ambiguous entries are not admitted."""

    def __init__(self):
        super().__init__()
        self.entries = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and attributes.get("type") == "module":
            self.entries.append(attributes.get("src"))


def public_revision(origin: str, revision: str) -> None:
    """Observe the public entry bundle's revision without writing an artifact.

    This checks the served revision, not publication integrity of every asset.
    Reads are bounded even if the server ignores its Content-Length header.
    """
    def read(path: str, limit: int) -> str:
        with urlopen(urljoin(origin + "/", path), timeout=15) as response:
            final = urlsplit(response.geturl())
            if (final.scheme, final.netloc) != ("https", urlsplit(origin).netloc):
                raise ValueError("Viewer response redirected away from the configured public origin")
            content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError(f"Public viewer response exceeds {limit} bytes")
        return content.decode("utf-8")

    document = EntryScript()
    document.feed(read("/", 512 * 1024))
    if (len(document.entries) != 1 or not isinstance(document.entries[0], str)
            or not re.fullmatch(r"(?:\./|/)?assets/[A-Za-z0-9_.-]+\.js", document.entries[0])):
        raise ValueError("Public viewer index must declare one local assets/*.js module")
    if revision not in read(document.entries[0], 8 * 1024 * 1024):
        raise ValueError(f"Public viewer entry bundle does not identify revision {revision}")


def make(target: str, *, image: str | None = None) -> None:
    """Reuse Make's recursive endpoint handoff and the existing runtime settings."""
    args = ["make", "--no-print-directory", target, "DOCKER_CONTEXT=",
            "CAM_DOCKER_ENDPOINT=" + os.environ["CAM_DOCKER_ENDPOINT"],
            "COMPOSE_PROJECT_NAME=cam-viewer-update",
            "VIEWER_COMPOSE_PROJECT_NAME=" + os.environ["VIEWER_COMPOSE_PROJECT_NAME"],
            "VIEWER_BIND_HOST=" + os.environ["VIEWER_BIND_HOST"], "VIEWER_PORT=" + os.environ["VIEWER_PORT"]]
    if image:
        args.append("VIEWER_IMAGE=" + image)
    if target == "base-images/pull":
        args.append("DOCKERFILES=containers/node-deps/Dockerfile containers/https-egress-proxy/Dockerfile containers/viewer/Dockerfile")
    # Build/install progress belongs in the journal; keep it visible immediately.
    execute(args, timeout=75 if target in ("viewer/up", "viewer/isolated/viewer/up") else 600, capture=False)


def isolated_ingress(project: str, viewer: dict | None, *, require_health: bool) -> str | None:
    """Identify the running topology before choosing how to replace a viewer."""
    try:
        return inspect_isolated_ingress(project, viewer, require_health=require_health)
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError("Cannot determine viewer ingress state; inspect the runtime before retrying") from error


def inspect_isolated_ingress(project: str, viewer: dict | None, *, require_health: bool) -> str | None:
    """Admit the legacy viewer or the exact running isolated gateway topology."""
    gateways = docker("container", "ls", "--all", "--quiet", "--no-trunc",
                      "--filter", f"label=com.docker.compose.project={project}",
                      "--filter", "label=com.docker.compose.service=viewer-ingress",
                      "--filter", "label=com.docker.compose.oneoff=False").splitlines()
    bindings = viewer["HostConfig"]["PortBindings"] if viewer is not None else {}
    if bindings is None:
        bindings = {}
    if not isinstance(bindings, dict):
        raise ValueError("Cannot determine viewer port bindings")
    expected = [{"HostIp": os.environ["VIEWER_BIND_HOST"], "HostPort": os.environ["VIEWER_PORT"]}]
    if bindings.get("8080/tcp") == expected and not gateways:
        return None
    if bindings or len(gateways) != 1:
        raise ValueError("Viewer runtime or bind/port settings differ from the supported topology; migrate them manually")
    gateway = inspect("container", gateways[0])
    if (gateway["State"]["Running"] is not True
            or (require_health and not healthy(gateway))
            or gateway["HostConfig"]["PortBindings"] != {"8080/tcp": expected}):
        raise ValueError("Viewer ingress is unhealthy or has different bind/port settings; recover it manually")
    private = f"{project}_viewer_private"
    ingress = f"{project}_viewer_ingress"
    if ((viewer is not None and set(viewer["NetworkSettings"]["Networks"]) != {private})
            or set(gateway["NetworkSettings"]["Networks"]) != {private, ingress}
            or inspect("network", private).get("Internal") is not True):
        raise ValueError("Viewer ingress networks do not match the isolated topology; recover it manually")
    return gateways[0]


def wait_for_ingress(project: str, viewer: dict, gateway: str) -> None:
    """Wait for the gateway's backend-dependent health check after replacement."""
    deadline = time.monotonic() + 20
    while True:
        try:
            if isolated_ingress(project, viewer, require_health=True) != gateway:
                raise ValueError("Viewer ingress changed during replacement")
            return
        except ValueError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)


def observe_isolated_revision(origin: str, revision: str) -> None:
    """Allow the ingress's short DNS cache to expire after viewer replacement."""
    deadline = time.monotonic() + 8
    while True:
        try:
            public_revision(origin, revision)
            return
        except (OSError, ValueError, TimeoutError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)


def require_ingress_configuration(project: str, gateway: str) -> None:
    """Check the running gateway against Compose before replacing its backend."""
    container = inspect("container", gateway)
    config = container.get("Config")
    labels = config.get("Labels") if isinstance(config, dict) else None
    if not isinstance(labels, dict):
        raise ValueError("Cannot determine the running viewer ingress configuration")
    rendered = run("docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], "compose", "--env-file", "/dev/null",
                   "-p", project, "-f", "compose/viewer-isolated.yml", "config", "--hash", "viewer-ingress")
    match = re.fullmatch(r"viewer-ingress ([0-9a-f]{64})", rendered)
    if not match or labels.get("com.docker.compose.config-hash") != match.group(1):
        raise ValueError("Viewer ingress configuration differs from this checkout; migrate it manually before updating")


def require_isolated_updater(revision: str) -> None:
    """Do not replace this controller with one unable to maintain the runtime."""
    try:
        source = run("git", "show", revision + ":tools/viewer_update.py")
        makefile = run("git", "show", revision + ":Makefile")
        statements = ast.parse(source).body
    except (subprocess.CalledProcessError, SyntaxError) as error:
        raise ValueError("Selected release lacks an isolated viewer updater; select a compatible release or recover manually") from error
    declarations = [node for node in statements if isinstance(node, ast.Assign)
                    and any(isinstance(name, ast.Name) and name.id == "ISOLATED_VIEWER_UPDATER" for name in node.targets)]
    supported = (len(declarations) == 1 and isinstance(declarations[0].value, ast.Constant)
                 and declarations[0].value.value is True)
    if not supported or not re.search(r"(?m)^viewer/isolated/viewer/up:", makefile):
        raise ValueError("Selected release lacks an isolated viewer updater; select a compatible release or recover manually")


def retire_images(project: str, repository: str) -> None:
    """Retire only this updater's obsolete image tags; Docker refuses in-use removal.

    Separate builds may deliberately keep other tags. Preserve such images,
    all container references, and the current image. Never force image removal.
    """
    protected = set(docker("image", "ls", "--quiet", "--no-trunc", "--filter", f"reference={repository}:current").splitlines())
    containers = docker("container", "ls", "--all", "--quiet", "--no-trunc").splitlines()
    if containers:
        for container in json.loads(docker("container", "inspect", *containers)):
            image = container["Image"]
            if not IMAGE_ID.fullmatch(image):
                raise ValueError("Cannot establish container image references for cleanup")
            protected.add(image)
    filters = ("--filter", "label=com.cam.role=viewer", "--filter", f"label=com.cam.viewer.project={project}",
               "--filter", f"label=org.opencontainers.image.source={SOURCE}")
    for identifier in set(docker("image", "ls", "--quiet", "--no-trunc", *filters).splitlines()):
        if identifier in protected:
            continue
        image = inspect("image", identifier)
        tags = image["RepoTags"]
        if tags and all(tag.startswith(repository + ":") for tag in tags):
            for tag in tags:
                docker("image", "rm", tag)
    docker("image", "prune", "--force", *filters)


def update() -> None:
    """Perform one attempt; preserve Docker recovery inputs until success is known."""
    project = os.environ["VIEWER_COMPOSE_PROJECT_NAME"]
    if "VIEWER_PUBLIC_ORIGIN" not in os.environ:
        raise ValueError("Set VIEWER_PUBLIC_ORIGIN to the viewer's HTTPS origin")
    origin = os.environ["VIEWER_PUBLIC_ORIGIN"]
    url = urlsplit(origin)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError("Set VIEWER_PUBLIC_ORIGIN to an HTTPS origin without credentials, path, query or fragment")
    if run("git", "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Viewer update refuses local source changes; preserve them before retrying")
    run("git", "fetch", "--atomic", "--no-tags", "origin",
        "refs/heads/main:refs/remotes/origin/main",
        "refs/heads/deploy/viewer:refs/remotes/origin/deploy/viewer")
    target = run("git", "rev-parse", "--verify", "refs/remotes/origin/deploy/viewer^{commit}")
    main = run("git", "rev-parse", "--verify", "refs/remotes/origin/main^{commit}")
    if not REVISION.fullmatch(target) or not REVISION.fullmatch(main):
        raise ValueError("Fetched deployment and main branches must each resolve to one exact source revision")
    # The release branch selects published main history; it is not a separate
    # development line. Check immutable commits from the same atomic fetch.
    try:
        run("git", "merge-base", "--is-ancestor", target, main)
    except subprocess.CalledProcessError as error:
        if error.returncode == 1:
            raise ValueError("Deployment revision is outside main; publish main first, then promote a commit already contained in main") from error
        raise
    # Historical viewer releases predate this entrypoint. Checking them out
    # would remove the controller that the next timer attempt needs to run.
    try:
        run("git", "cat-file", "-e", target + ":tools/viewer_update.py")
    except subprocess.CalledProcessError as error:
        raise ValueError("Selected revision has no viewer updater; keep deploy/viewer on updater-capable source or migrate manually") from error
    container = live_viewer(project, allow_missing=False)
    if not healthy(container):
        raise ValueError("Viewer is unhealthy; recover it before updating")
    gateway = isolated_ingress(project, container, require_health=True)
    if gateway:
        require_isolated_updater(target)
        require_ingress_configuration(project, gateway)
    activation_target = "viewer/isolated/viewer/up" if gateway else "viewer/up"
    old_id = container["Image"]
    old_revision = image_revision(inspect("image", old_id), project)
    repository = "cam-viewer-" + project
    runtime_files = ("compose/viewer.yml", "compose/viewer-isolated.yml") if gateway else ("compose/viewer.yml",)
    def require_same_runtime(revision: str) -> None:
        try:
            for path in runtime_files:
                if run("git", "show", revision + ":" + path) != run("git", "show", target + ":" + path):
                    raise ValueError("Deployment changes viewer runtime configuration; migrate runtime configuration manually before enabling automatic updates")
        except subprocess.CalledProcessError as error:
            raise ValueError("Viewer release lacks its runtime configuration; migrate it manually before enabling automatic updates") from error
    if gateway:
        require_same_runtime("HEAD")
    if old_revision == target:
        public_revision(origin, target)
        run("git", "checkout", "--detach", target)
        docker("image", "tag", old_id, repository + ":current")
        retire_images(project, repository)
        print(f"Viewer already healthy at {target}; no build needed.", flush=True)
        return
    # Runtime settings stay in operator configuration. Refuse model changes
    # instead of secretly creating snapshots or risking incompatible rollback.
    require_same_runtime(old_revision)
    run("git", "checkout", "--detach", target)
    if gateway:
        require_ingress_configuration(project, gateway)
    make("base-images/pull")
    make("js/deps/install")
    if run("git", "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Dependency preparation changed source; running viewer was left unchanged")
    candidate = repository + ":" + target
    try:
        make("viewer/image/build", image=candidate)
        image = inspect("image", candidate)
        candidate_id = image["Id"]
        if not IMAGE_ID.fullmatch(candidate_id) or image_revision(image, project) != target:
            raise ValueError("Built image identity does not match the fetched release")
        # Builds take time. Only replace the still-healthy starting image;
        # a changed or broken runtime is not this attempt's rollback target.
        previous = live_viewer(project, allow_missing=False)
        if previous["Image"] != old_id or not healthy(previous):
            raise ValueError("Viewer changed or became unhealthy during preparation; no replacement attempted")
        if isolated_ingress(project, previous, require_health=True) != gateway:
            raise ValueError("Viewer ingress changed during preparation; no replacement attempted")
        public_revision(origin, old_revision)
        docker("image", "tag", old_id, repository + ":current")
        try:
            make(activation_target, image=candidate_id)
            current = live_viewer(project, allow_missing=False)
            if current["Image"] != candidate_id or not healthy(current):
                raise ValueError("Replacement viewer did not reach healthy state with the selected image")
            if gateway:
                wait_for_ingress(project, current, gateway)
                observe_isolated_revision(origin, target)
            else:
                public_revision(origin, target)
        except (OSError, ValueError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt) as activation:
            print(f"Activation failed: {activation}. Attempting rollback to {old_id}.", file=sys.stderr, flush=True)
            try:
                make(activation_target, image=old_id)
                restored = live_viewer(project, allow_missing=False)
                if restored["Image"] != old_id or not healthy(restored):
                    raise ValueError("Rollback runtime is not healthy with the pre-update image")
                if gateway:
                    wait_for_ingress(project, restored, gateway)
                    observe_isolated_revision(origin, old_revision)
                else:
                    public_revision(origin, old_revision)
            except (OSError, ValueError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt) as recovery:
                print(f"Rollback failed: {recovery}", file=sys.stderr, flush=True)
                status_target = "viewer/isolated/status" if gateway else "viewer/status"
                raise RuntimeError(f"Rollback could not be confirmed; images retained. Inspect {status_target} and recover with {activation_target} VIEWER_IMAGE={old_id}") from recovery
            print("Rollback is healthy; the attempted update still failed.", file=sys.stderr, flush=True)
            raise
        docker("image", "tag", candidate_id, repository + ":current")
        print(f"Viewer is healthy and publicly serves {target}.", flush=True)
    except RuntimeError:
        # Uncertain rollback: do not retire any possible recovery input.
        raise
    except (OSError, ValueError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt):
        try:
            retire_images(project, repository)
        except (OSError, ValueError, subprocess.SubprocessError) as cleanup:
            print(f"Image cleanup also failed; obsolete images may remain: {cleanup}", file=sys.stderr)
        raise
    retire_images(project, repository)


def interrupted(signum, frame):
    raise TimeoutError("Viewer update interrupted; an activation in progress will attempt rollback")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    try:
        if sys.argv[1:] == ["--check-isolated-runtime"]:
            project = os.environ["VIEWER_COMPOSE_PROJECT_NAME"]
            gateway = isolated_ingress(project, live_viewer(project, allow_missing=True), require_health=False)
            if gateway is None:
                raise ValueError("An existing isolated viewer and healthy ingress are required")
            require_ingress_configuration(project, gateway)
        elif len(sys.argv) == 1:
            update()
        else:
            raise ValueError("Unsupported viewer updater command")
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt) as error:
        print(f"Viewer update failed: {error}", file=sys.stderr)
        sys.exit(1)
