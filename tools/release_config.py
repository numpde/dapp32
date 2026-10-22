"""Collect a self-contained release configuration and unpack it for existing release lanes."""

import argparse
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import urlsplit


# These are operator inputs, not the generated release plan or contract validation.
COMMON_FIELDS = (
    ("EXPECTED_CHAIN_ID", "Target chain ID", "chain"),
    ("EXPECTED_DEPLOYER_ADDRESS", "Expected funded deployer address (enter independently of the signing key)", "address"),
    ("CAM_URI", "Published CAM manifest URI (HTTPS or IPFS)", "uri"),
    ("CAM_HASH", "CAM hash (auto uses manifest SHA-256; 0x followed by 64 zeros leaves it unverified in the viewer)", "cam-hash"),
    ("INTENDED_CAM_ROOT_OWNER", "CAM owner address (can change the manifest and bindings)", "address"),
)
APP_FIELDS = {
    "escrow": (),
    "pay-to-play": (
        ("INTENDED_PAYMENT_ADMIN", "Payment admin address (creates service channels and changes payees)", "address"),
        ("NULL_CLAIM_PERIOD", "Channel 0 withdrawal wait in seconds (0 to 2592000)", "claim-period"),
    ),
    "bike-nft": (
        ("TOKEN_NAME", "NFT collection name", "text"),
        ("TOKEN_SYMBOL", "NFT symbol", "text"),
        ("BASE_TOKEN_URI", "Base token metadata URI", "text"),
        ("COLLECTION_URI", "Collection metadata URI", "text"),
        ("INTENDED_COMPONENTS_ADMIN", "Components administrator address", "address"),
        ("COMPONENTS_ADMIN_DELAY", "Components administrator transfer delay in seconds (positive uint48)", "delay"),
        ("COMPONENTS_PAUSER", "Components pauser address", "address"),
        ("COMPONENTS_CONFIGURER", "Components configurer address", "address"),
        ("INTENDED_MANAGER_ADMIN", "Manager administrator address", "address"),
        ("MANAGER_ADMIN_DELAY", "Manager administrator transfer delay in seconds (positive uint48)", "delay"),
        ("MANAGER_PAUSER", "Manager pauser address", "address"),
        ("MANAGER_CONFIGURER", "Manager configurer address", "address"),
        ("REGISTRARS", "Registrar addresses, separated by commas", "addresses"),
    ),
}
OUTPUT_FIELD = ("OUTPUT_DIR", "New deployment output directory (absolute, outside this checkout; parent must exist)", "path")
KEY_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
MAX_CONFIG_BYTES = 65536
CONFIG_VERSION = 2
# Public repeated-pattern key, pre-funded by the local network's genesis.
# This preset is a test fixture, never an operator credential.
LOCAL_DEPLOYER_KEY = "0x" + "ba" * 32
LOCAL_DEPLOYER_ADDRESS = "0xfe7854Bc8cA79FBE9DC94Dfdaf8c10E5C6deCAB7"
LOCAL_RPC_URL = "http://release-anvil:8545"


def fields(app):
    return (*COMMON_FIELDS, *APP_FIELDS[app], OUTPUT_FIELD)


def check_value(value, kind):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 4096:
        raise ValueError("Enter a nonempty value of at most 4096 UTF-8 bytes.")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Values must fit on one line without control characters.")
    if kind in ("chain", "claim-period", "delay"):
        if not re.fullmatch(r"0|[1-9][0-9]*", value) or len(value) > 16:
            raise ValueError("Enter a decimal integer without leading zeros.")
        number = int(value)
        maximum = {"chain": 9007199254740991, "claim-period": 2592000, "delay": 281474976710655}[kind]
        minimum = {"chain": 1, "claim-period": 0, "delay": 1}[kind]
        if not minimum <= number <= maximum or (kind == "chain" and number in (1337, 31337)):
            raise ValueError(f"Enter an integer from {minimum} through {maximum}; fixture chain IDs are excluded.")
    elif kind in ("address", "addresses"):
        addresses = value.split(",")
        if kind == "address" and len(addresses) != 1:
            raise ValueError("Enter one nonzero EVM address.")
        if any(not re.fullmatch(r"0x[0-9a-fA-F]{40}", address) or int(address[2:], 16) == 0 for address in addresses):
            raise ValueError("Enter nonzero EVM addresses without surrounding spaces.")
        if len({address.lower() for address in addresses}) != len(addresses):
            raise ValueError("Registrar addresses must be distinct.")
    elif kind == "uri":
        parsed = urlsplit(value)
        if parsed.scheme not in ("https", "ipfs") or not parsed.netloc or any(char in value for char in "$`\\\"'; "):
            raise ValueError("Enter an absolute HTTPS or IPFS URI without whitespace or shell syntax.")
    elif kind == "path":
        if not value.startswith("/") or str(PurePosixPath(value)) != value or ".." in PurePosixPath(value).parts or value == "/":
            raise ValueError("Enter a normalized absolute path, with no dot segments or trailing slash.")
    elif kind == "rpc":
        try:
            parsed = urlsplit(value)
            valid = parsed.scheme == "https" and parsed.hostname and parsed.port in (None, 443) and not parsed.username and not parsed.password and not parsed.fragment
        except ValueError:
            valid = False
        if not valid or any(char.isspace() for char in value) or "{" in value or "}" in value:
            raise ValueError("Enter the complete HTTPS RPC URL on port 443, without userinfo, fragments or placeholders.")
    elif kind == "key":
        if not re.fullmatch(r"0x[0-9a-fA-F]{64}", value) or not 0 < int(value[2:], 16) < KEY_ORDER:
            raise ValueError("Enter a valid 32-byte EVM private key with a 0x prefix.")
    elif kind == "cam-hash":
        if value != "auto" and not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
            raise ValueError("Enter auto or 0x followed by 64 hexadecimal digits.")
    elif kind == "network":
        if value not in ("public", "local"):
            raise ValueError("Choose public or local.")
    elif kind == "docker-network":
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", value):
            raise ValueError("Enter a Docker network name containing only letters, digits, underscores, dots and hyphens.")
    return value


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("The configuration contains duplicate JSON keys.")
        result[key] = value
    return result


def validate(config, app, source_commit):
    if not isinstance(config, dict) or type(config.get("schemaVersion")) is not int or config["schemaVersion"] != CONFIG_VERSION:
        raise ValueError("The saved release configuration has an unsupported version; run the release setup again.")
    expected = {"schemaVersion", "app", "sourceCommit", "rpcUrl", "deployerPrivateKey", "settings", "confirmDeploy"}
    if isinstance(config, dict) and "localNetwork" in config:
        expected.add("localNetwork")
    if config.keys() != expected:
        raise ValueError("The release configuration has missing or unknown fields; run the release setup again.")
    if config["app"] != app:
        raise ValueError("The configuration belongs to a different app; use its release target.")
    if config["sourceCommit"] != source_commit:
        raise ValueError("The configuration pins a different source commit; use that commit or run the walkthrough again.")
    if config["confirmDeploy"] is not True:
        raise ValueError("The configuration has no saved deployment confirmation; finish the walkthrough.")
    check_value(config["deployerPrivateKey"], "key")
    settings = config["settings"]
    names = {name for name, _, _ in fields(app)}
    if not isinstance(settings, dict) or not names - {"CAM_HASH"} <= settings.keys() <= names:
        raise ValueError("The release configuration settings are incomplete or unknown; run the release setup again.")
    local = "localNetwork" in config
    if local:
        check_value(config["localNetwork"], "docker-network")
        if (config["rpcUrl"] != LOCAL_RPC_URL or config["deployerPrivateKey"] != LOCAL_DEPLOYER_KEY
                or settings["EXPECTED_CHAIN_ID"] != "31338" or settings["EXPECTED_DEPLOYER_ADDRESS"] != LOCAL_DEPLOYER_ADDRESS
                or settings["CAM_URI"] != f"http://release-cam:8080/{app}/main.json"):
            raise ValueError("Local releases require the fixture chain, RPC, funded deployer account and this app's CAM manifest.")
    else:
        check_value(config["rpcUrl"], "rpc")
    for name, _, kind in fields(app):
        if name == "CAM_HASH" and name not in settings:
            continue
        if local and name == "CAM_URI":
            continue
        try:
            check_value(settings[name], kind)
        except ValueError as error:
            raise ValueError(f"Invalid {name}: {error}") from error
    return config


def ask(label, kind, previous, *, secret):
    while True:
        prompt = label
        if previous and not secret:
            prompt += f" [{previous}]"
        prompt += ": "
        value = getpass.getpass(prompt) if secret else input(prompt)
        value = value or previous
        try:
            return check_value(value, kind)
        except ValueError as error:
            print(error, file=sys.stderr)


def write_private(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(content)


def setup(app, source_commit, output):
    print(f"Release setup: {app}, source {source_commit}")
    network = ask("Target network [public/local]", "network", "", secret=False)
    print("Enter the actual deployment values. RPC URL and signing key are stored in the protected configuration.")
    print("Saving records approval to deploy these settings later. Setup itself sends no transactions.")
    config = {"schemaVersion": CONFIG_VERSION, "app": app, "sourceCommit": source_commit, "rpcUrl": "", "deployerPrivateKey": "", "settings": {name: "" for name, _, _ in fields(app)}, "confirmDeploy": True}
    config["settings"]["CAM_HASH"] = "auto"
    if network == "local":
        if "RELEASE_LOCAL_NETWORK" not in os.environ:
            raise ValueError("Run local setup through make <app>/release/setup so its Docker network is selected.")
        config["localNetwork"] = check_value(os.environ["RELEASE_LOCAL_NETWORK"], "docker-network")
        config["rpcUrl"] = LOCAL_RPC_URL
        config["deployerPrivateKey"] = LOCAL_DEPLOYER_KEY
        config["settings"].update(EXPECTED_CHAIN_ID="31338", EXPECTED_DEPLOYER_ADDRESS=LOCAL_DEPLOYER_ADDRESS, CAM_URI=f"http://release-cam:8080/{app}/main.json")
        if app != "bike-nft":
            config["settings"]["INTENDED_CAM_ROOT_OWNER"] = LOCAL_DEPLOYER_ADDRESS
        if app == "pay-to-play":
            config["settings"]["INTENDED_PAYMENT_ADMIN"] = LOCAL_DEPLOYER_ADDRESS
        print(f"Local Docker network: {config['localNetwork']}")
        print(f"Local funded test account: {LOCAL_DEPLOYER_ADDRESS}")
        print("Local RPC and CAM URLs are reachable only by containers on this Docker network.")
        print("CAM uses HTTP, not HTTPS. No host ports are published; your host browser cannot open this URL.")
    while True:
        if network == "public":
            config["rpcUrl"] = ask("Complete RPC URL (including any API key)", "rpc", config["rpcUrl"], secret=True)
            config["deployerPrivateKey"] = ask("Funded deployer private key", "key", config["deployerPrivateKey"], secret=True)
        for name, label, kind in fields(app):
            if network == "local" and name in ("EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS", "CAM_URI"):
                print(f"{name}: {config['settings'][name]}")
                continue
            if name == "OUTPUT_DIR":
                print("Deployment creates this directory to keep plans, transaction records and deployed contract addresses.")
                print("Verification reads its artifact/deployment.json later. Keep it after deployment, including failures.")
                print("Choose a new path such as /tmp/local-release; its parent must exist, but do not create the directory yourself.")
            config["settings"][name] = ask(label, kind, config["settings"][name], secret=False)
        validate(config, app, source_commit)
        print(f"\nApp: {app}\nNetwork: {network}\nSource: {source_commit}\nRPC URL: saved (hidden)\nDeployer key: saved (hidden)")
        for name, value in config["settings"].items():
            print(f"{name}: {value}")
        print("Deployment confirmation: YES")
        decision = input("Save this ready-to-deploy configuration, change inputs, or cancel? [save/change/cancel]: ").strip().lower()
        while decision not in ("save", "change", "cancel"):
            decision = input("Choose save, change or cancel: ").strip().lower()
        if decision == "save":
            write_private(output / "release.json", (json.dumps(config, indent=2) + "\n").encode())
            return
        if decision == "cancel":
            raise ValueError("Setup cancelled; no deployment configuration was saved.")


def unpack(app, source_commit, mode, source, output):
    with source.open("rb") as handle:
        raw = handle.read(MAX_CONFIG_BYTES + 1)
    if len(raw) > MAX_CONFIG_BYTES:
        raise ValueError("The configuration exceeds 65536 bytes.")
    try:
        config = json.loads(raw, object_pairs_hook=unique_fields)
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError("The configuration is not valid UTF-8 JSON; no inputs were loaded.") from None
    validate(config, app, source_commit)
    prefix = app.upper().replace("-", "_")
    if mode == "verify":
        settings = {f"{prefix}_DEPLOYMENT_ARTIFACT_FILE": config["settings"]["OUTPUT_DIR"] + "/artifact/deployment.json"}
    else:
        settings = {f"{prefix}_RELEASE_CAM_HASH": "auto"}
        settings.update({f"{prefix}_RELEASE_{name}": value for name, value in config["settings"].items()})
        settings[f"CONFIRM_{prefix}_RELEASE_DEPLOY"] = "YES"
    if "localNetwork" in config:
        settings["RELEASE_REHEARSAL"] = "1"
        settings["RELEASE_REHEARSAL_NETWORK"] = config["localNetwork"]
    else:
        settings["RELEASE_REHEARSAL"] = "0"
    encoded = b"".join(f"{name}={value}\0".encode() for name, value in settings.items())
    write_private(output / "inputs", encoded)
    write_private(output / "rpc-url", (config["rpcUrl"] + "\n").encode())
    if mode == "deploy":
        write_private(output / "deployer-key", (config["deployerPrivateKey"] + "\n").encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("setup", "deploy", "verify"))
    parser.add_argument("app", choices=tuple(APP_FIELDS))
    parser.add_argument("source_commit")
    args = parser.parse_args()
    try:
        if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
            raise ValueError("Release setup requires one exact 40-character source commit.")
        if args.mode == "setup":
            setup(args.app, args.source_commit, Path("/out"))
        else:
            unpack(args.app, args.source_commit, args.mode, Path("/run/release.json"), Path("/out"))
    except (OSError, ValueError, EOFError, KeyboardInterrupt) as error:
        if isinstance(error, OSError):
            reason = f"File operation failed ({error.strerror})."
        elif isinstance(error, (EOFError, KeyboardInterrupt)):
            reason = "Setup interrupted; no ready-to-deploy configuration was saved."
        else:
            reason = str(error)
        print(f"Cannot prepare release configuration: {reason}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
