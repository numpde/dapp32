"""Select instance records and allocate operation directories; phase tools verify effects."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parent))
from release_config import unique_fields, APP_FIELDS


ARTIFACTS = {
    "deployment.json": "legacy",
    "contract-deployment.json": "business",
    "ui-deployment.json": "ui",
    "cam-publication.json": "publication",
    "cam-bundle.json": "bundle",
}
OPERATIONS = {
    "deploy": ("", ("contracts", "ui", "cam")),
    "ui/update": ("", ("ui", "cam")),
    "contracts/deploy": ("contracts", ("contracts",)),
    "ui/deploy": ("ui", ("ui",)),
    "cam/bundle": ("cam-bundle", ()),
    "cam/publish": ("cam", ("cam",)),
}
PHASE_ARTIFACTS = {"contracts": "contract-deployment.json", "ui": "ui-deployment.json", "cam": "cam-publication.json"}
RECORD_PORTS = {f"{phase}/artifact": f"{phase.upper() if phase != 'contracts' else 'CONTRACT'}_RECORDS" for phase in PHASE_ARTIFACTS}

SKIP_DIRECTORIES = {"approval-artifacts", "sources", "compiler", "node_modules", ".git", "control"}


def read_json(path):
    with path.open("rb") as stream:
        content = stream.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        raise ValueError(f"Instance metadata is too large: {path}")
    value = json.loads(content, object_pairs_hook=unique_fields)
    if not isinstance(value, dict):
        raise ValueError(f"Instance metadata must be a JSON object: {path}")
    return value


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path, value):
    """Replace selection metadata atomically; never use this for deployment artifacts."""
    descriptor, temporary = tempfile.mkstemp(prefix=".instance-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def instance_path(root, relative):
    if not isinstance(relative, str) or not relative or PurePosixPath(relative).is_absolute() or ".." in PurePosixPath(relative).parts or str(PurePosixPath(relative)) != relative or any(ord(char) < 32 for char in relative):
        raise ValueError("Instance record references must be relative paths inside this instance.")
    path = root / relative
    for parent in (path, *path.parents):
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError(f"Instance record path is a symlink: {relative}")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Instance record path escapes the instance: {relative}")
    return path


# silent-defaults: allow-default -- Human selection is required unless the caller permits its sole unambiguous choice.
def choose(label, choices, *, automatic=False):
    if not choices:
        raise ValueError(f"{label}: no saved records are available.")
    if automatic and len(choices) == 1:
        return choices[0][1]
    if not sys.stdin.isatty():
        raise ValueError(f"{label}: run this command in an interactive terminal to choose saved work.")
    print(label)
    for index, (caption, _) in enumerate(choices, 1):
        print(f"  {index}. {caption}")
    print("  0. Cancel")
    while True:
        answer = input("Choose: ").strip()
        if answer == "0":
            raise ValueError("Instance command cancelled; no transaction was requested.")
        if answer.isdecimal() and 1 <= int(answer) <= len(choices):
            return choices[int(answer) - 1][1]
        print("Enter one of the listed numbers.")


def inventory(root, app):
    records = []
    for directory, directories, names in os.walk(root, followlinks=False):
        directories[:] = sorted(name for name in directories if name not in SKIP_DIRECTORIES and not (Path(directory) / name).is_symlink() and not name.startswith("."))
        if Path(directory).name != "artifact":
            continue
        for name in sorted(set(names) & ARTIFACTS.keys()):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            artifact = read_json(instance_path(root, relative))
            schema = artifact["schema"]
            kind = ARTIFACTS[name]
            if kind == "legacy":
                if schema not in (f"{app}.deployment.v1", f"{app}.deployment.v2"):
                    continue
            elif artifact.get("app") != app:
                continue
            records.append((kind, relative, artifact))
    return records


def select_artifact(root, records, kind, selected=None):
    choices = []
    for role, relative, artifact in records:
        if role != kind and not (role == "legacy" and kind in ("business", "publication")):
            continue
        source = artifact["authoringSourceCommit"] if role == "bundle" else artifact["sourceCommit"]
        caption = f"{relative} · source {source[:8]} · chain {artifact['chainId']}"
        if relative == selected:
            caption += " · selected"
        choices.append((caption, relative))
    choices.sort(key=lambda choice: (choice[1] != selected, choice[1]))
    return choose(f"Choose {kind} records", choices, automatic=True)


def business_for_publication(root, records, publication):
    artifact = read_json(instance_path(root, publication))
    if artifact["schema"].endswith((".deployment.v1", ".deployment.v2")):
        return publication
    expected = artifact["businessArtifactSha256"].removeprefix("0x")
    candidates = {relative for kind, relative, _ in records if kind in ("business", "legacy")}
    # CAM-only publication retains its exact backing copy with the prepared bundle.
    selected = load_selection(root).get("business")
    if selected:
        candidates.add(selected)
    matching = [relative for relative in candidates
                if hashlib.sha256(instance_path(root, relative).read_bytes()).hexdigest() == expected]
    if not matching:
        raise ValueError("The selected CAM publication's business artifact is missing. Restore its original records before updating the UI.")
    # Identical copies have the same authority; their directory timestamps do not.
    return min(matching, key=lambda relative: (len(PurePosixPath(relative).parts), relative))


def new_action(root, operation):
    parent = instance_path(root, "updates" if operation in ("ui/update", "ui/deploy", "cam/bundle", "cam/publish") else "deployments")
    parent.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = instance_path(root, (parent / f"{stamp}-{operation.replace('/', '-')}").relative_to(root).as_posix())
    path.mkdir(mode=0o700)
    sync_directory(parent)
    return path


def configurations(selection, operation):
    # silent-defaults: allow-default -- config.json is the documented default instance configuration.
    default = selection.get("config", "config.json")
    # silent-defaults: allow-default -- A separate business actor is optional; otherwise use the instance configuration.
    business = selection.get("businessConfig", default)
    # silent-defaults: allow-default -- A separate ui actor is optional; otherwise use the instance configuration.
    ui = selection.get("uiConfig", default)
    # silent-defaults: allow-default -- A separate cam actor is optional; otherwise use the instance configuration.
    cam = selection.get("camConfig", default)
    if operation == "deploy":
        return {"CONFIG": business, "UI_CONFIG": ui, "CAM_CONFIG": cam}
    if operation == "ui/update":
        return {"CONFIG": ui, "CAM_CONFIG": cam}
    return {"CONFIG": ui if operation == "ui/deploy" else cam if operation.startswith("cam/") else business}


def load_selection(root):
    path = root / "instance.json"
    if not path.exists():
        return {"config": "config.json"}
    return read_json(instance_path(root, "instance.json"))


def repair_bundle(root, request, action):
    prepared = instance_path(root, request["inputs"]["CAM_BUNDLE"]) if "CAM_BUNDLE" in request["inputs"] else action / "cam-bundle"
    if not prepared.is_dir() or (prepared / "artifact/cam-bundle.json").exists() or (action / "cam").exists():
        return None
    choose("The bundle export is incomplete", [("Rebuild CAM files from the saved components; no transactions", "repair")])
    saved = request["inputs"]
    # silent-defaults: allow-default -- Saved explicit inputs override the full operation's conventional phase paths.
    inputs = {"CONFIG": saved.get("CAM_CONFIG", saved["CONFIG"])}
    for retained in (prepared / "inputs/configuration.json", action / "inputs/cam.json"):
        if retained.is_file():
            inputs["CONFIG"] = retained.relative_to(root).as_posix()
            break
    # silent-defaults: allow-default -- Full deployment owns this phase path; UI updates retain an explicit external backing reference.
    inputs["CONTRACT_ARTIFACT"] = saved.get("CONTRACT_ARTIFACT", (action / "contracts/artifact/contract-deployment.json").relative_to(root).as_posix())
    # silent-defaults: allow-default -- New UI deployment owns this phase path; a reuse update retains its explicit UI reference.
    inputs["UI_ARTIFACT"] = saved.get("UI_ARTIFACT", (action / "ui/artifact/ui-deployment.json").relative_to(root).as_posix())
    if "ROOT_ARTIFACT" in saved:
        inputs["ROOT_ARTIFACT"] = saved["ROOT_ARTIFACT"]
    else:
        inputs["ROOT"] = "new"
    parent = instance_path(root, (action / "bundle-recovery").relative_to(root).as_posix())
    parent.mkdir(mode=0o700, exist_ok=True)
    destination = parent / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return {**request, "requestedOperation": "cam/bundle", "inputs": inputs, "repairOutput": destination.relative_to(root).as_posix()}


def saved_actions(root):
    actions = []
    for directory in ("deployments", "updates"):
        parent = instance_path(root, directory)
        if parent.exists():
            for path in sorted(parent.glob("*/selection.json")):
                relative = path.relative_to(root).as_posix()
                request = read_json(instance_path(root, relative))
                if request.get("operation") not in OPERATIONS or not isinstance(request.get("inputs"), dict):
                    raise ValueError(f"Unsupported saved operation in {relative}.")
                actions.append((path.parent, request))
    return actions


def completion_file(root, request, action):
    if request["operation"] in ("deploy", "ui/update", "cam/publish"):
        return publication_for(action)
    output, phases = OPERATIONS[request["operation"]]
    if request["operation"] == "cam/bundle" and "CAM_BUNDLE" in request["inputs"]:
        return instance_path(root, request["inputs"]["CAM_BUNDLE"]) / "artifact/cam-bundle.json"
    filename = PHASE_ARTIFACTS[phases[0]] if phases else "cam-bundle.json"
    return action / output / "artifact" / filename


def select_saved_work(root, selection, actions):
    choices = [(action.relative_to(root).as_posix(), (action, request)) for action, request in actions]
    action, request = choose("Choose saved work", choices, automatic=True)
    if completion_file(root, request, action).is_file():
        # Historical final records are observations, not a request to roll active selection back.
        return selection, {**request, "requestedOperation": "verify"}, action
    selection["pending"] = action.relative_to(root).as_posix()
    write_json(root / "instance.json", selection)
    return selection, request, action


def prepare(root, app, operation):
    selection = load_selection(root)
    if operation.startswith("viewer/"):
        inputs = {}
        if operation == "viewer/up":
            inputs["DEPLOYMENT_ARTIFACT_FILE"] = select_artifact(root, inventory(root, app), "publication", selection.get("publication"))
        return selection, {"operation": operation, "inputs": inputs}, root
    if operation == "setup":
        roles = [(caption, name) for caption, name in (("Full deployment configuration", "config.json"), ("Business creator configuration", "business-config.json"), ("UI deployer configuration", "ui-config.json"), ("CAM owner configuration", "cam-config.json")) if not instance_path(root, name).exists()]
        config = choose("Choose configuration to create", roles, automatic=True)
        key = {"config.json": "config", "business-config.json": "businessConfig", "ui-config.json": "uiConfig", "cam-config.json": "camConfig"}[config]
        purpose = {"config": "deployment", "businessConfig": "contracts", "uiConfig": "ui", "camConfig": "cam"}[key]
        selection[key] = config
        # Setup needs an output port for its existing admission; it never creates a paid operation.
        action = instance_path(root, "deployments/setup")
        action.parent.mkdir(mode=0o700, exist_ok=True)
        return selection, {"operation": operation, "configurationRole": key, "purpose": purpose, "inputs": {"CONFIG": config}}, action
    records = inventory(root, app)
    actions = saved_actions(root)
    if operation in RECORD_PORTS or operation == "verify":
        eligible = []
        for action, request in actions:
            phases = OPERATIONS[request["operation"]][1]
            if (operation == "verify" and phases) or (operation != "verify" and operation.split("/")[0] in phases):
                eligible.append((action.relative_to(root).as_posix(), (action, request)))
        action, request = choose("Choose saved operation to verify or complete", eligible, automatic=True)
        return selection, {**request, "requestedOperation": operation}, action
    pending = selection.get("pending")
    new_requested = False
    if pending:
        action = instance_path(root, pending)
        request = read_json(action / "selection.json")
        if request["operation"] in ("deploy", "ui/update", "cam/bundle") and operation in (request["operation"], "cam/bundle"):
            repaired = repair_bundle(root, request, action)
            if repaired is not None:
                return selection, repaired, action
        choices = [(f"Resume {request['operation']} in {pending}", "resume")]
        if OPERATIONS[request["operation"]][1]:
            choices.append(("Verify or reconcile these records without signing", "verify"))
        if any(candidate != action for candidate, _ in actions):
            choices.append(("Choose another saved operation", "history"))
        choices.append((f"Start {operation} separately; keep these records (may create additional contracts)", "new"))
        decision = choose("Unfinished operation", choices)
        if decision == "resume":
            return selection, request, action
        if decision == "verify":
            return selection, {**request, "requestedOperation": "verify"}, action
        if decision == "history":
            return select_saved_work(root, selection, [(candidate, saved) for candidate, saved in actions if candidate != action])
        new_requested = True
    history = [(candidate, saved) for candidate, saved in actions if saved["operation"] == operation]
    if history and operation != "ui/update" and not new_requested:
        choice = choose("Choose operation", [("Resume or verify saved work", "history"),
                                             ("Start separately; keep earlier records (may create additional contracts)", "new")])
        if choice == "history":
            return select_saved_work(root, selection, history)
    inputs = configurations(selection, operation)
    for relative in inputs.values():
        if not instance_path(root, relative).is_file():
            raise ValueError(f"Missing instance configuration: {relative}. Run release/setup for this instance.")
    if operation == "ui/update":
        print("To make the app use a replacement, this command prepares matching CAM files locally, then updates the existing CAM root's contract addresses and manifest URI/hash.")
        print("Upload or pin the prepared files yourself before approving CAM root changes.")
        print("Without a configured URI, the command pauses for hosting. Repeat it after hosting to enter the manifest URI.")
        print("A configured URI skips that pause, but each transaction still needs approval.")
        print(f"Use {app}/release/ui/deploy to create a UI contract without updating the CAM root.")
        choices = [("Deploy a new UI contract and make the app use it", "new"), ("Make the app use a saved UI contract", "reuse")]
        history = [(candidate, saved) for candidate, saved in actions if saved["operation"] == "ui/update"]
        if history:
            choices.append(("Resume or verify a saved update", "history"))
        choice = choose("Replace the app's UI contract", choices)
        if choice == "history":
            return select_saved_work(root, selection, history)
        inputs["ROOT_ARTIFACT"] = select_artifact(root, records, "publication", selection.get("publication"))
        inputs["CONTRACT_ARTIFACT"] = business_for_publication(root, records, inputs["ROOT_ARTIFACT"])
        if choice == "reuse":
            inputs["UI_ARTIFACT"] = select_artifact(root, records, "ui")
    elif operation == "ui/deploy":
        inputs["CONTRACT_ARTIFACT"] = select_artifact(root, records, "business", selection.get("business"))
    elif operation == "cam/bundle":
        inputs["CONTRACT_ARTIFACT"] = select_artifact(root, records, "business", selection.get("business"))
        inputs["UI_ARTIFACT"] = select_artifact(root, records, "ui")
        roots = [("Create a new CAM root", None)]
        roots += [(relative, relative) for kind, relative, _ in records if kind in ("publication", "legacy")]
        selected = choose("Choose CAM root", roots, automatic=True)
        if selected is None:
            inputs["ROOT"] = "new"
        else:
            inputs["ROOT_ARTIFACT"] = selected
    elif operation == "cam/publish":
        inputs["CAM_BUNDLE"] = str(PurePosixPath(select_artifact(root, records, "bundle")).parent.parent)
        bundle_root = instance_path(root, inputs["CAM_BUNDLE"]) / "inputs/root.json"
        original = read_json(bundle_root) if bundle_root.exists() else None
        if original:
            inputs["ROOT_ARTIFACT"] = bundle_root.relative_to(root).as_posix()
        else:
            inputs["ROOT"] = "new"
    elif operation not in ("deploy", "contracts/deploy"):
        raise ValueError(f"Unsupported instance operation: {operation}")
    if operation == "deploy" and selection.get("publication"):
        choose("This creates new business contracts and a new CAM root", [("Start a new full deployment", "new")])
    action = new_action(root, operation)
    request = {"operation": operation, "inputs": inputs}
    write_json(action / "selection.json", request)
    selection["pending"] = action.relative_to(root).as_posix()
    write_json(root / "instance.json", selection)
    return selection, request, action


def arguments(root, app, request, action, host_root):
    # silent-defaults: allow-default -- Artifact/verify selection overrides execution; ordinary resume retains the original operation.
    operation = request.get("requestedOperation", request["operation"])
    if operation.startswith("viewer/"):
        project = "cam-viewer-" + hashlib.sha256(host_root.encode()).hexdigest()[:12]
        args = [operation.replace("viewer/", "viewer/release/"), "INSTANCE=", "MAKEOVERRIDES=", f"RELEASE_VIEWER_COMPOSE_PROJECT_NAME={project}"]
        if operation == "viewer/up":
            relative = request["inputs"]["DEPLOYMENT_ARTIFACT_FILE"]
            instance_path(root, relative)
            args += [f"DEPLOYMENT_ARTIFACT_FILE={Path(host_root) / relative}", f"APP={app}"]
        return args
    allowed = {"CONFIG", "UI_CONFIG", "CAM_CONFIG", "CONTRACT_ARTIFACT", "UI_ARTIFACT", "ROOT_ARTIFACT", "CAM_BUNDLE", "ROOT"}
    resolved = {}
    for name, value in request["inputs"].items():
        if name not in allowed:
            raise ValueError(f"Unsupported saved operation input: {name}")
        if name == "ROOT":
            if value != "new":
                raise ValueError("Saved root selection must be new or an artifact reference.")
            resolved[name] = value
        else:
            instance_path(root, value)
            resolved[name] = str(Path(host_root) / value)
    original = request["operation"]
    if original == "setup":
        resolved["RELEASE_SETUP_PURPOSE"] = request["purpose"]
    phases = OPERATIONS[original][1] if original in OPERATIONS else ()
    if operation == "verify" and len(phases) == 1:
        operation = f"{phases[0]}/artifact"
    output = action if original == "setup" else action / OPERATIONS[original][0]
    if "repairOutput" in request:
        output = instance_path(root, request["repairOutput"])
    if original == "cam/bundle" and "repairOutput" not in request and completion_file(root, request, action).is_file():
        return []
    if operation == original and original in ("contracts/deploy", "ui/deploy") and output.exists():
        operation = original.replace("/deploy", "/artifact")
    if original == "cam/publish" and output.exists() and operation == original:
        resolved["CAM_RECORDS"] = str(Path(host_root) / output.relative_to(root))
    resolved["OUTPUT_DIR"] = str(Path(host_root) / output.relative_to(root))
    if operation in RECORD_PORTS:
        phase = operation.split("/")[0]
        if phase == "cam":
            records = publication_for(action).parent.parent
        elif phase == "ui" and "UI_ARTIFACT" in request["inputs"]:
            records = instance_path(root, request["inputs"]["UI_ARTIFACT"]).parent.parent
        else:
            records = action / phase
        resolved[RECORD_PORTS[operation]] = str(Path(host_root) / records.relative_to(root))
        if phase == "cam" and "CAM_BUNDLE" not in resolved:
            resolved["CAM_BUNDLE"] = str(Path(host_root) / action.relative_to(root) / "cam-bundle")
    return [f"{app}/release/{operation}", "INSTANCE=", "MAKEOVERRIDES=", *(f"{name}={value}" for name, value in resolved.items())]


def publication_for(action):
    records = action / "cam"
    while (records / "continuation").is_dir():
        records = records / "continuation"
    return records / "artifact/cam-publication.json"


def finish(root, request, action):
    selection = load_selection(root)
    # silent-defaults: allow-default -- Artifact/verify selection overrides execution; ordinary resume retains the original operation.
    operation = request.get("requestedOperation", request["operation"])
    if operation == "setup":
        selection[request["configurationRole"]] = request["inputs"]["CONFIG"]
        write_json(root / "instance.json", selection)
        return
    if selection.get("pending") != action.relative_to(root).as_posix():
        # Observing historical work must not change the selected deployment or another pending action.
        return
    if "repairOutput" in request:
        destination = instance_path(root, request["repairOutput"])
        if not (destination / "artifact/cam-bundle.json").is_file():
            raise ValueError("Bundle repair returned without its admitted artifact; the pending operation is unchanged.")
        original = read_json(action / "selection.json")
        original["inputs"]["CAM_BUNDLE"] = request["repairOutput"]
        write_json(action / "selection.json", original)
        if original["operation"] == "cam/bundle":
            del selection["pending"]
            write_json(root / "instance.json", selection)
        return
    publication = publication_for(action)
    if publication.is_file():
        business = action / "contracts/artifact/contract-deployment.json"
        if not business.is_file():
            if "CONTRACT_ARTIFACT" in request["inputs"]:
                business = instance_path(root, request["inputs"]["CONTRACT_ARTIFACT"])
            else:
                business = instance_path(root, request["inputs"]["CAM_BUNDLE"]) / "inputs/business.json"
        selection["business"] = business.relative_to(root).as_posix()
        selection["publication"] = publication.relative_to(root).as_posix()
        del selection["pending"]
    elif request["operation"] not in ("deploy", "ui/update"):
        if completion_file(root, request, action).is_file():
            del selection["pending"]
    write_json(root / "instance.json", selection)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "finish"))
    parser.add_argument("app")
    parser.add_argument("operation")
    parser.add_argument("host_root")
    options = parser.parse_args()
    root = Path("/instance")
    app = options.app
    if app == "_" and options.operation != "viewer/down":
        selected = load_selection(root).get("publication")
        document = read_json(instance_path(root, selected)) if selected else read_json(instance_path(root, "config.json"))
        app = document.get("app") or document["schema"].split(".deployment.")[0]
        if app not in APP_FIELDS:
            raise ValueError("Cannot identify the instance app from its selected publication or configuration.")
    if options.mode == "prepare":
        selection, request, action = prepare(root, app, options.operation)
        write_json(Path("/out/selection.json"), {"request": request, "action": action.relative_to(root).as_posix()})
        args = arguments(root, app, request, action, options.host_root)
        Path("/out/arguments").write_bytes(b"\0".join(value.encode() for value in args) + (b"\0" if args else b""))
        Path("/out/operation").write_text(request["operation"] + "\n")
    else:
        chosen = read_json(Path("/out/selection.json"))
        finish(root, chosen["request"], instance_path(root, chosen["action"]))
    if options.mode == "finish":
        chosen = read_json(Path("/out/selection.json"))
        if options.operation == "setup":
            next_operation = {"deployment": "deploy", "contracts": "contracts/deploy", "ui": "ui/deploy", "cam": "cam/bundle"}[chosen["request"]["purpose"]]
        elif load_selection(root).get("pending") == chosen["action"]:
            next_operation = chosen["request"]["operation"]
        else:
            next_operation = {"deploy": "verify", "ui/update": "verify", "contracts/deploy": "ui/deploy",
                              "ui/deploy": "cam/bundle", "cam/bundle": "cam/publish", "cam/publish": "verify"}[chosen["request"]["operation"]]
        import shlex
        print(f"Next: make {app}/release/{next_operation} INSTANCE={shlex.quote(options.host_root)}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, EOFError) as error:
        print(f"Cannot select instance work: {error}", file=sys.stderr)
        raise SystemExit(2)
