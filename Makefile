SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE_DIR := compose
DOCKER_COMPOSE ?= docker compose
# Intentional default: the default project name is convenient locally, but it
# can collide with another checkout/user. Prefer explicit COMPOSE_PROJECT_NAME
# for shared machines, CI, and parallel scenario runs.
COMPOSE_PROJECT_NAME ?= dapps
DAPPS_DIR := dapps
JS_DIR := js
DEPENDENCIES_DIR := $(DAPPS_DIR)/dependencies
FOUNDRY_MANIFEST_FILE := $(DAPPS_DIR)/foundry.toml
DEPENDENCY_METADATA_FILES := $(DAPPS_DIR)/soldeer.lock $(DAPPS_DIR)/remappings.txt $(DAPPS_DIR)/dependency-checksums.txt
PACKAGE_MANIFEST_FILE := $(JS_DIR)/package.json
PACKAGE_NODE_MODULES_DIR := $(JS_DIR)/node_modules
PACKAGE_LOCK_FILE := $(JS_DIR)/package-lock.json
ACTUAL_UID := $(shell id -u)
LOCAL_UID ?= $(shell id -u)
LOCAL_GID ?= $(shell id -g)
ALLOW_UPDATE ?= 0

RPC_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-cast-rpc
ANVIL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-anvil
ANVIL_HOST_PORT ?= 8545
LIVE_CHECK_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-check-live
BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-bike-nft-local
BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-bike-nft-viewer-terminal
BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-bike-nft-viewer-gui
TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-test-integration-fuzz
TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-test-integration-fuzz-bike-nft
TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-test-integration-fuzz-with-writes-bike-nft
BIKE_NFT_GUI_PORT ?= 5173
BIKE_NFT_GUI_BIND_HOST ?= 127.0.0.1
BIKE_NFT_GUI_ORIGIN ?= http://127.0.0.1:$(BIKE_NFT_GUI_PORT)
CAM_INTEGRATION_SEED ?= cam-integration-fuzz
CAM_INTEGRATION_RUNS ?= 1
CAM_INTEGRATION_STEPS ?= 16
VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-viewer-terminal
VIEWER_TERMINAL_CONTAINER_NAME ?= $(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME)-session
VIEWER_TERMINAL_MOCK ?= bike-nft
# Intentional fixture default: bytes32(0) means the local demo deploy is
# unsigned. Pass BIKE_NFT_CAM_HASH to pin real CAM bytes.
CAM_URI ?=
BIKE_NFT_CAM_HASH ?= 0x0000000000000000000000000000000000000000000000000000000000000000
BIKE_NFT_CAM_HTTP_ORIGIN := http://bike-nft-cam-http:8080
BIKE_NFT_BROADCAST_DIR := /foundry-broadcast
BIKE_NFT_BROADCAST_PATH := $(BIKE_NFT_BROADCAST_DIR)/DeployBikeNftLocal.s.sol/31337/run-latest.json

export ANVIL_HOST_PORT BIKE_NFT_GUI_PORT BIKE_NFT_GUI_BIND_HOST BIKE_NFT_GUI_ORIGIN
export CAM_INTEGRATION_SEED CAM_INTEGRATION_RUNS CAM_INTEGRATION_STEPS
export LOCAL_UID LOCAL_GID ALLOW_UPDATE
export CAM_URI BIKE_NFT_CAM_HASH
export VIEWER_TERMINAL_MOCK
COMPOSE_PROJECT_NAME_VARS := COMPOSE_PROJECT_NAME RPC_COMPOSE_PROJECT_NAME ANVIL_COMPOSE_PROJECT_NAME LIVE_CHECK_COMPOSE_PROJECT_NAME BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME VIEWER_TERMINAL_COMPOSE_PROJECT_NAME VIEWER_TERMINAL_CONTAINER_NAME
export $(COMPOSE_PROJECT_NAME_VARS)

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)
DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
PACKAGE_DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
RPC_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_COMPOSE_PROJECT_NAME)
ANVIL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(ANVIL_COMPOSE_PROJECT_NAME)
# The live egress check renders compose/deps.yml but does not install/update
# dependencies; force locked-mode interpolation for unrelated services there.
LIVE_CHECK_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(LIVE_CHECK_COMPOSE_PROJECT_NAME) ALLOW_UPDATE=0
BIKE_NFT_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) CAM_HASH=$(BIKE_NFT_CAM_HASH) BIKE_NFT_BROADCAST_DIR=$(BIKE_NFT_BROADCAST_DIR) BIKE_NFT_BROADCAST_PATH=$(BIKE_NFT_BROADCAST_PATH)
BIKE_NFT_LOCAL_COMPOSE_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME) CAM_URI=$(CAM_URI)
BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME) CAM_URI=$(BIKE_NFT_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(BIKE_NFT_CAM_HTTP_ORIGIN)
BIKE_NFT_VIEWER_GUI_COMPOSE_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME) CAM_URI=$(BIKE_NFT_GUI_ORIGIN)/cam/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(BIKE_NFT_GUI_ORIGIN) BIKE_NFT_GUI_PORT=$(BIKE_NFT_GUI_PORT) BIKE_NFT_GUI_BIND_HOST=$(BIKE_NFT_GUI_BIND_HOST) BIKE_NFT_GUI_ORIGIN=$(BIKE_NFT_GUI_ORIGIN)
TEST_INTEGRATION_FUZZ_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME) CAM_INTEGRATION_SEED=$(CAM_INTEGRATION_SEED) CAM_INTEGRATION_RUNS=$(CAM_INTEGRATION_RUNS) CAM_INTEGRATION_STEPS=$(CAM_INTEGRATION_STEPS)
TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME) CAM_URI=$(BIKE_NFT_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(BIKE_NFT_CAM_HTTP_ORIGIN) CAM_INTEGRATION_SEED=$(CAM_INTEGRATION_SEED) CAM_INTEGRATION_RUNS=$(CAM_INTEGRATION_RUNS) CAM_INTEGRATION_STEPS=$(CAM_INTEGRATION_STEPS)
TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME) CAM_URI=$(BIKE_NFT_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(BIKE_NFT_CAM_HTTP_ORIGIN) CAM_INTEGRATION_SEED=$(CAM_INTEGRATION_SEED) CAM_INTEGRATION_RUNS=$(CAM_INTEGRATION_RUNS) CAM_INTEGRATION_STEPS=$(CAM_INTEGRATION_STEPS)
VIEWER_TERMINAL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME) VIEWER_TERMINAL_CONTAINER_NAME=$(VIEWER_TERMINAL_CONTAINER_NAME) CAM_VIEWER_MOCK=$(VIEWER_TERMINAL_MOCK)
ANVIL_INTERNAL_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=internal
ANVIL_HOST_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=host ANVIL_HOST_PORT=$(ANVIL_HOST_PORT)
ANVIL_ALL_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=internal,host ANVIL_HOST_PORT=$(ANVIL_HOST_PORT)
LIVE_DEPS_EGRESS_COMPOSE_FILES := -f $(COMPOSE_DIR)/deps.yml -f $(COMPOSE_DIR)/check-live-deps-egress.yml
CAM_COMPOSE_FILES := -f $(COMPOSE_DIR)/cam.yml
CAM_PUBLICATION_PREFLIGHT_COMPOSE_FILES := -f $(COMPOSE_DIR)/cam-publication.yml
FORGE_ABI_COMPOSE_FILES := -f $(COMPOSE_DIR)/forge-abi.yml
BIKE_NFT_LOCAL_COMPOSE_FILES := -f $(COMPOSE_DIR)/bike-nft/local/deploy.yml
BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES := -f $(COMPOSE_DIR)/bike-nft/local/deploy.yml -f $(COMPOSE_DIR)/bike-nft/local/http.yml -f $(COMPOSE_DIR)/bike-nft/local/viewer-terminal.yml
BIKE_NFT_VIEWER_GUI_COMPOSE_FILES := -f $(COMPOSE_DIR)/bike-nft/local/deploy.yml -f $(COMPOSE_DIR)/bike-nft/local/http.yml -f $(COMPOSE_DIR)/bike-nft/local/viewer-gui.yml
TEST_INTEGRATION_FUZZ_COMPOSE_FILES := -f $(COMPOSE_DIR)/test/integration-fuzz.yml
TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES := -f $(COMPOSE_DIR)/bike-nft/local/deploy.yml -f $(COMPOSE_DIR)/bike-nft/local/http.yml -f $(COMPOSE_DIR)/bike-nft/local/test-integration-fuzz.yml
# Docker resolves host bind sources before container policy applies. Guard the
# first-party roots in every lane, not only in the repository hygiene checks.
FIRST_PARTY_ROOTS := compose containers dapps js tests tools
COMPOSE_PROJECT_NAME_GUARD := for name in $(COMPOSE_PROJECT_NAME_VARS); do value="$${!name:?missing_$$name}"; if [[ ! "$$value" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$$ ]]; then printf '%s must be a Docker-safe name, not a path or shell expression.\n' "$$name" >&2; exit 2; fi; done
NON_ROOT_GUARD := uid="$${LOCAL_UID:?missing_LOCAL_UID}"; gid="$${LOCAL_GID:?missing_LOCAL_GID}"; if [[ ! "$$uid" =~ ^[1-9][0-9]*$$ || ! "$$gid" =~ ^[1-9][0-9]*$$ ]]; then printf '%s\n' 'LOCAL_UID and LOCAL_GID must be positive decimal integers.' >&2; exit 2; fi; if [[ "$(ACTUAL_UID)" == "0" || "$$uid" == "0" ]]; then printf '%s\n' 'Refusing to run Docker lanes as root or with LOCAL_UID=0. Run make as a non-root user.' >&2; exit 2; fi
ALLOW_UPDATE_GUARD := if [[ "$${ALLOW_UPDATE:?missing_ALLOW_UPDATE}" != "0" && "$$ALLOW_UPDATE" != "1" ]]; then printf '%s\n' 'ALLOW_UPDATE must be 0 or 1.' >&2; exit 2; fi
REPO_SHAPE_GUARD := for path in $(FIRST_PARTY_ROOTS); do if [[ -L "$$path" ]]; then printf 'Refusing Docker lane because first-party root is a symlink: %s\n' "$$path" >&2; exit 2; fi; if [[ -e "$$path" && ! -d "$$path" ]]; then printf 'Refusing Docker lane because first-party root is not a directory: %s\n' "$$path" >&2; exit 2; fi; done; symlink="$$(find $(FIRST_PARTY_ROOTS) \( -path "dapps/dependencies" -o -path "js/node_modules" \) -prune -o -type l -print -quit)"; if [[ -n "$$symlink" ]]; then printf 'Refusing Docker lane because first-party path is a symlink: %s\n' "$$symlink" >&2; exit 2; fi
LANE_GUARD := $(COMPOSE_PROJECT_NAME_GUARD); $(NON_ROOT_GUARD); $(REPO_SHAPE_GUARD)
ANVIL_HOST_PORT_GUARD := port="$${ANVIL_HOST_PORT:?missing_ANVIL_HOST_PORT}"; if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'ANVIL_HOST_PORT must be an integer from 1 to 65535.' >&2; exit 2; fi
BIKE_NFT_GUI_BIND_GUARD := port="$${BIKE_NFT_GUI_PORT:?missing_BIKE_NFT_GUI_PORT}"; host="$${BIKE_NFT_GUI_BIND_HOST:?missing_BIKE_NFT_GUI_BIND_HOST}"; origin="$${BIKE_NFT_GUI_ORIGIN:?missing_BIKE_NFT_GUI_ORIGIN}"; if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'BIKE_NFT_GUI_PORT must be an integer from 1 to 65535.' >&2; exit 2; fi; if [[ "$$host" != "localhost" ]]; then IFS=. read -r a b c d extra <<< "$$host"; for octet in "$$a" "$$b" "$$c" "$$d"; do if [[ -z "$$octet" || ! "$$octet" =~ ^[0-9]{1,3}$$ || "$$octet" -gt 255 ]]; then printf '%s\n' 'BIKE_NFT_GUI_BIND_HOST must be localhost or an IPv4 literal.' >&2; exit 2; fi; done; if [[ -n "$$extra" ]]; then printf '%s\n' 'BIKE_NFT_GUI_BIND_HOST must be localhost or an IPv4 literal.' >&2; exit 2; fi; fi; if [[ ! "$$origin" =~ ^https?://[^:/@?\#]+(:[1-9][0-9]{0,4})?$$ || "$$origin" == *'$$'* || "$$origin" == *'`'* || "$$origin" == *\\* || "$$origin" == *\"* || "$$origin" == *\'* || "$$origin" == *\;* || "$$origin" == *\#* ]]; then printf '%s\n' 'BIKE_NFT_GUI_ORIGIN must be an http(s) origin without credentials, path, query, fragment, invalid port, or shell syntax.' >&2; exit 2; fi; if [[ "$$origin" =~ :([1-9][0-9]{0,4})$$ ]]; then origin_port="$${BASH_REMATCH[1]}"; if [[ "$$origin_port" -gt 65535 ]]; then printf '%s\n' 'BIKE_NFT_GUI_ORIGIN port must be an integer from 1 to 65535.' >&2; exit 2; fi; fi
BIKE_NFT_CAM_HASH_GUARD := if [[ ! "$${BIKE_NFT_CAM_HASH:?missing_BIKE_NFT_CAM_HASH}" =~ ^0x[0-9a-fA-F]{64}$$ ]]; then printf '%s\n' 'BIKE_NFT_CAM_HASH must be a 32-byte hex value.' >&2; exit 2; fi
CAM_URI_GUARD := uri="$${CAM_URI?missing_CAM_URI}"; if [[ -z "$$uri" ]]; then printf '%s\n' 'Set CAM_URI to the CAM document URI for the local fixture.' >&2; exit 2; fi; if [[ ! "$$uri" =~ ^(https?|ipfs):// || "$$uri" == *'$$'* || "$$uri" == *'`'* || "$$uri" == *\"* || "$$uri" == *\'* || "$$uri" == *\;* ]]; then printf '%s\n' 'CAM_URI must be an absolute http(s) or ipfs URI without shell syntax.' >&2; exit 2; fi
CAM_INTEGRATION_INPUT_GUARD := seed="$${CAM_INTEGRATION_SEED:?missing_CAM_INTEGRATION_SEED}"; runs="$${CAM_INTEGRATION_RUNS:?missing_CAM_INTEGRATION_RUNS}"; steps="$${CAM_INTEGRATION_STEPS:?missing_CAM_INTEGRATION_STEPS}"; if [[ ! "$$seed" =~ ^[A-Za-z0-9_.:-]{1,128}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_SEED must be 1-128 URL-safe label characters.' >&2; exit 2; fi; if [[ ! "$$runs" =~ ^[1-9][0-9]{0,3}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_RUNS must be a positive decimal integer under 10000.' >&2; exit 2; fi; if [[ ! "$$steps" =~ ^[1-9][0-9]{0,3}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_STEPS must be a positive decimal integer under 10000.' >&2; exit 2; fi
VIEWER_TERMINAL_MOCK_GUARD := if [[ ! "$${VIEWER_TERMINAL_MOCK:?missing_VIEWER_TERMINAL_MOCK}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$$ ]]; then printf '%s\n' 'VIEWER_TERMINAL_MOCK must be a mock name, not a path or shell expression.' >&2; exit 2; fi
# Intentional default: cleanup handlers intentionally ignore Compose teardown
# failure so the user sees the primary lane failure. Do not use this outside
# best-effort cleanup paths where the original status is preserved separately.
COMPOSE_DOWN_CLEANUP := down --volumes --remove-orphans >/dev/null 2>&1 || true

define compose_run
@$(LANE_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

PACKAGE_DEPS_GUARD := if [[ -L "$(PACKAGE_NODE_MODULES_DIR)" || -L "$(PACKAGE_LOCK_FILE)" ]]; then printf '%s\n' 'Refusing package lane because node_modules or package-lock.json is a symlink.' >&2; exit 2; fi; if [[ ! -d "$(PACKAGE_NODE_MODULES_DIR)" || ! -f "$(PACKAGE_LOCK_FILE)" ]]; then printf '%s\n' 'Missing npm workspace dependencies. Run make package-deps to install the locked package dependencies.' >&2; exit 2; fi
SOLDEER_DEPS_GUARD := if [[ -L "$(DEPENDENCIES_DIR)" || -L "$(FOUNDRY_MANIFEST_FILE)" ]]; then printf '%s\n' 'Refusing Soldeer lane because dapps/dependencies or dapps/foundry.toml is a symlink.' >&2; exit 2; fi; if [[ ! -d "$(DEPENDENCIES_DIR)" || ! -f "$(FOUNDRY_MANIFEST_FILE)" ]]; then printf '%s\n' 'Missing Soldeer dependencies. Run make deps to install the locked Solidity dependencies.' >&2; exit 2; fi; for file in $(DEPENDENCY_METADATA_FILES); do if [[ -L "$$file" ]]; then printf 'Refusing Soldeer lane because metadata file is a symlink: %s\n' "$$file" >&2; exit 2; fi; if [[ ! -f "$$file" ]]; then printf 'Missing Soldeer metadata: %s\n' "$$file" >&2; exit 2; fi; done

define compose_run_with_package_deps
@$(LANE_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

.PHONY: help deps deps-verify package-deps package-graph-check package-build-check package-test package-ci cam-conformance-check cam-publication-preflight cam-publication-preflight-json cam-publication-preflight-check viewer-terminal-check cam-integration-fuzz-check checks check-runtime check-live check-live-deps-egress viewer-terminal viewer-terminal-status viewer-terminal-attach viewer-terminal-down check-anvil-compose fmt build script-build abi cam-integrity test fuzz invariant test-integration-fuzz test-integration-fuzz-bike-nft test-integration-fuzz-with-writes-bike-nft test-integration-fuzz-bike-nft-down coverage ci cast-offline cast-rpc anvil-internal anvil-host anvil-down anvil bike-nft-local-deploy bike-nft-viewer-terminal bike-nft-viewer-terminal-down bike-nft-viewer-gui bike-nft-viewer-gui-down

help:
	@printf '%s\n' \
	  'Supported lanes:' \
	  '  make deps         Install only the currently locked Soldeer dependencies' \
	  '  make deps ALLOW_UPDATE=1  Allow dependency lock/remapping/checksum updates' \
	  '  make deps-verify  Verify installed dependencies against committed checksums' \
	  '  make package-deps Install only the currently locked npm workspace dependencies' \
	  '  make package-deps ALLOW_UPDATE=1  Allow package-lock.json updates' \
	  '  make package-graph-check  Check installed npm dependency graph offline' \
	  '  make package-build-check  Validate npm workspace builds offline' \
	  '  make package-test   Build and test npm workspace packages/apps offline' \
	  '  make package-ci     Run JS workspace tests and package-backed tool checks offline' \
	  '  make cam-conformance-check  Validate checked-in CAM bundles offline' \
	  '  make cam-publication-preflight DAPP=... CAM_URI=...  Validate a CAM bundle and print CAM_HASH' \
	  '  make cam-publication-preflight-json DAPP=... CAM_URI=...  Same preflight with structured JSON output' \
	  '  make cam-publication-preflight-check  Smoke-check publication preflight offline' \
	  '  make viewer-terminal-check  Smoke-check the CAM viewer terminal offline' \
	  '  make cam-integration-fuzz-check  Typecheck the CAM integration fuzz runner offline' \
	  '  make viewer-terminal  Run the CAM viewer terminal offline; defaults to VIEWER_TERMINAL_MOCK=bike-nft' \
	  '  make viewer-terminal-status  Show viewer terminal Compose status' \
	  '  make viewer-terminal-attach  Attach if the mock viewer terminal is still running' \
	  '  make viewer-terminal-down    Stop and clean up the viewer terminal Compose project' \
	  '  make checks       Run offline repository/source checks' \
	  '  make check-runtime  Run local Docker-backed runtime checks' \
	  '  make check-live    Run live checks that intentionally use external network' \
	  '  make check-live-deps-egress  Prove dependency egress allow/deny behavior' \
	  '  make check-anvil-compose  Run only the rendered Anvil Compose posture checks' \
	  '  make fmt          Check Solidity formatting for all dapps' \
	  '  make build        Compile all dapp source trees' \
	  '  make script-build Compile all dapp deployment scripts without executing them' \
	  '  make abi          Export CAM manifest-declared ABIs and refresh CAM integrity pins' \
	  '  make cam-integrity  Refresh CAM manifest sha256 pins for local ABI/UI resources' \
	  '  make test         Run unit tests for all dapps' \
	  '  make fuzz         Run fuzz tests for all dapps' \
	  '  make invariant    Run invariant tests for all dapps' \
	  '  make test-integration-fuzz CAM_INTEGRATION_DESCRIPTOR_HOST_PATH=/path CAM_INTEGRATION_NETWORK=name  Run generic CAM integration fuzzing against an existing deployment' \
	  '  make test-integration-fuzz-bike-nft  Deploy bike NFT locally and run generic CAM integration fuzzing' \
	  '  make test-integration-fuzz-with-writes-bike-nft  Deploy bike NFT locally and run integration fuzzing with local fixture writes' \
	  '  make coverage     Print coverage summary from all dapp unit tests' \
	  '  make ci           Run fmt, build, script-build, unit, fuzz, invariant, and package-ci lanes' \
	  '  make cast-offline Run offline cast smoke lane' \
	  '  make cast-rpc RPC_URL_FILE=/path  Read a block number through the RPC egress proxy' \
	  '  RPC_URL=https://... make cast-rpc  Same, using a temporary secret file' \
	  '  make anvil-internal  Start Docker-only Anvil with no host port' \
	  '  make anvil-host      Start Anvil on 127.0.0.1:$${ANVIL_HOST_PORT}' \
	  '  make anvil-down      Stop Anvil services and remove their network' \
	  '  make bike-nft-local-deploy CAM_URI=...  Deploy the bike NFT fixture to an internal Anvil' \
	  '                        Fixture default: BIKE_NFT_CAM_HASH=0x00..00; pass BIKE_NFT_CAM_HASH to pin CAM bytes' \
	  '  make bike-nft-viewer-terminal  Deploy bike NFT locally and open the real-RPC viewer terminal' \
	  '  make bike-nft-viewer-gui       Deploy bike NFT locally and run the browser GUI on $${BIKE_NFT_GUI_ORIGIN}' \
	  '  BIKE_NFT_GUI_BIND_HOST=0.0.0.0 BIKE_NFT_GUI_ORIGIN=http://host:5173 make bike-nft-viewer-gui  Expose the local GUI to another browser host' \
	  '' \
	  'Supported lanes are Docker/Compose-backed. Default check lanes are offline, read-only,' \
	  'non-root, capability-free, and avoid writing build artifacts into the repo.' \
	  'Dependency install lanes are the only guarded host bind-target setup exception.'

deps:
	@$(LANE_GUARD); \
	$(ALLOW_UPDATE_GUARD); \
	created_dependency_metadata_placeholders=""; \
	cleanup() { \
	  status="$$?"; \
	  $(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml $(COMPOSE_DOWN_CLEANUP); \
	  if [[ "$$status" != "0" && -n "$$created_dependency_metadata_placeholders" ]]; then \
	    rm -f $$created_dependency_metadata_placeholders; \
	  fi; \
	  exit "$$status"; \
	}; \
	reject_unsafe_dependency_targets() { \
	  if [[ -L "$(DEPENDENCIES_DIR)" ]]; then \
	    printf '%s\n' 'Refusing dependency install because dapps/dependencies is a symlink.' >&2; \
	    exit 2; \
	  fi; \
	  if [[ -e "$(DEPENDENCIES_DIR)" && ! -d "$(DEPENDENCIES_DIR)" ]]; then \
	    printf '%s\n' 'Refusing dependency install because dapps/dependencies exists and is not a directory.' >&2; \
	    exit 2; \
	  fi; \
	  if [[ -L "$(FOUNDRY_MANIFEST_FILE)" ]]; then \
	    printf '%s\n' 'Refusing dependency install because dapps/foundry.toml is a symlink.' >&2; \
	    exit 2; \
	  fi; \
	  for file in $(DEPENDENCY_METADATA_FILES); do \
	    if [[ -L "$$file" ]]; then \
	      printf 'Refusing dependency install because metadata file is a symlink: %s\n' "$$file" >&2; \
	      exit 2; \
	    fi; \
	    if [[ -e "$$file" && ! -f "$$file" ]]; then \
	      printf 'Refusing dependency install because metadata target exists and is not a file: %s\n' "$$file" >&2; \
	      exit 2; \
	    fi; \
	  done; \
	}; \
	trap cleanup EXIT; \
	reject_unsafe_dependency_targets; \
	case "$$ALLOW_UPDATE" in \
	  0) \
	    apply_service="soldeer-apply-locked"; \
	    for file in $(DEPENDENCY_METADATA_FILES); do \
	      if [[ ! -f "$$file" ]]; then \
	        printf 'Missing locked dependency metadata: %s\n' "$$file" >&2; \
	        printf '%s\n' 'Run make deps ALLOW_UPDATE=1 only if creating or updating dependency metadata is intended.' >&2; \
	        exit 2; \
	      fi; \
	    done ;; \
	  1) \
	    apply_service="soldeer-apply-update"; \
	    for file in $(DEPENDENCY_METADATA_FILES); do \
	      if [[ ! -e "$$file" ]]; then \
	        touch "$$file"; \
	        created_dependency_metadata_placeholders="$$created_dependency_metadata_placeholders $$file"; \
	      fi; \
	    done ;; \
	  *) printf '%s\n' 'ALLOW_UPDATE must be 0 or 1.' >&2; exit 2 ;; \
	esac; \
	reject_unsafe_dependency_targets; \
	mkdir -p $(DEPENDENCIES_DIR); \
	test -d $(DEPENDENCIES_DIR); \
	reject_unsafe_dependency_targets; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml $(COMPOSE_DOWN_CLEANUP); \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-stage; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify-stage; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm "$$apply_service"; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify

deps-verify:
	@$(LANE_GUARD); \
	$(ALLOW_UPDATE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify

package-deps:
	@$(LANE_GUARD); \
	$(ALLOW_UPDATE_GUARD); \
	package_input_dir=""; \
	created_package_lock_placeholder="0"; \
	cleanup() { \
	  status="$$?"; \
	  if [[ -n "$$package_input_dir" ]]; then \
	    $(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml $(COMPOSE_DOWN_CLEANUP); \
	    rm -rf "$$package_input_dir"; \
	  fi; \
	  if [[ "$$status" != "0" && "$$created_package_lock_placeholder" == "1" ]]; then \
	    rm -f "$(PACKAGE_LOCK_FILE)"; \
	  fi; \
	  exit "$$status"; \
	}; \
	reject_unsafe_package_targets() { \
	  if [[ -L "$(PACKAGE_NODE_MODULES_DIR)" || -L "$(PACKAGE_LOCK_FILE)" ]]; then \
	    printf '%s\n' 'Refusing package dependency install because node_modules or package-lock.json is a symlink.' >&2; \
	    exit 2; \
	  fi; \
	  if [[ -e "$(PACKAGE_NODE_MODULES_DIR)" && ! -d "$(PACKAGE_NODE_MODULES_DIR)" ]]; then \
	    printf '%s\n' 'Refusing package dependency install because node_modules exists and is not a directory.' >&2; \
	    exit 2; \
	  fi; \
	  if [[ -e "$(PACKAGE_LOCK_FILE)" && ! -f "$(PACKAGE_LOCK_FILE)" ]]; then \
	    printf '%s\n' 'Refusing package dependency install because package-lock.json exists and is not a file.' >&2; \
	    exit 2; \
	  fi; \
	  if [[ -L "$(PACKAGE_MANIFEST_FILE)" ]]; then \
	    printf '%s\n' 'Refusing package dependency install because package.json is a symlink.' >&2; \
	    exit 2; \
	  fi; \
	}; \
	trap cleanup EXIT; \
	reject_unsafe_package_targets; \
	case "$$ALLOW_UPDATE" in \
	  0) \
	    apply_service="package-apply-locked"; \
	    if [[ ! -f "$(PACKAGE_LOCK_FILE)" ]]; then \
	      printf 'Missing locked package metadata: %s\n' "$(PACKAGE_LOCK_FILE)" >&2; \
	      printf '%s\n' 'Run make package-deps ALLOW_UPDATE=1 only if creating or updating package metadata is intended.' >&2; \
	      exit 2; \
	    fi ;; \
	  1) apply_service="package-apply-update" ;; \
	  *) printf '%s\n' 'ALLOW_UPDATE must be 0 or 1.' >&2; exit 2 ;; \
	esac; \
	package_input_dir="$$(mktemp -d)"; \
	cp "$(PACKAGE_MANIFEST_FILE)" "$$package_input_dir/package.json"; \
	if [[ -f "$(PACKAGE_LOCK_FILE)" ]]; then cp "$(PACKAGE_LOCK_FILE)" "$$package_input_dir/package-lock.json"; fi; \
	while IFS= read -r manifest; do \
	  if [[ -L "$$manifest" ]]; then \
	    printf 'Refusing package dependency install because package manifest is a symlink: %s\n' "$$manifest" >&2; \
	    exit 2; \
	  fi; \
	  if [[ ! -f "$$manifest" ]]; then \
	    printf 'Refusing package dependency install because package manifest is not a file: %s\n' "$$manifest" >&2; \
	    exit 2; \
	  fi; \
	  package_dir="$${manifest%/package.json}"; \
	  package_dir="$${package_dir#$(JS_DIR)/}"; \
	  mkdir -p "$$package_input_dir/$$package_dir"; \
	  cp "$$manifest" "$$package_input_dir/$$package_dir/package.json"; \
	done < <(find $(JS_DIR)/packages $(JS_DIR)/apps -mindepth 2 -maxdepth 2 -name package.json | sort); \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml $(COMPOSE_DOWN_CLEANUP); \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml run --build --rm package-stage; \
	reject_unsafe_package_targets; \
	mkdir -p "$(PACKAGE_NODE_MODULES_DIR)"; \
	test -d "$(PACKAGE_NODE_MODULES_DIR)"; \
	if [[ "$$ALLOW_UPDATE" = "1" && ! -e "$(PACKAGE_LOCK_FILE)" ]]; then \
	  touch "$(PACKAGE_LOCK_FILE)"; \
	  created_package_lock_placeholder=1; \
	fi; \
	test -f "$(PACKAGE_LOCK_FILE)"; \
	reject_unsafe_package_targets; \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml run --build --rm "$$apply_service"

package-graph-check:
	$(call compose_run_with_package_deps,packages.yml,package-graph-check)

package-build-check:
	$(call compose_run_with_package_deps,packages.yml,package-build-check)

package-test:
	$(call compose_run_with_package_deps,packages.yml,package-test)

package-ci: package-test viewer-terminal-check cam-publication-preflight-check cam-integration-fuzz-check

cam-conformance-check:
	$(call compose_run_with_package_deps,packages.yml,cam-conformance-check)

define cam_publication_preflight
	@$(LANE_GUARD); \
	if [[ -z "$$DAPP" ]]; then \
	  printf '%s\n' 'Set DAPP to the first-level dapp name, for example DAPP=bike-nft.' >&2; \
	  exit 2; \
	fi; \
	if [[ ! "$$DAPP" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$$ ]]; then \
	  printf '%s\n' 'DAPP must be a first-level dapp directory name, not a path or shell expression.' >&2; \
	  exit 2; \
	fi; \
	if [[ ! -f "$(DAPPS_DIR)/$$DAPP/cam/main.json" ]]; then \
	  printf '%s\n' 'DAPP must name a first-level dapp with cam/main.json.' >&2; \
	  exit 2; \
	fi; \
	if [[ -z "$$CAM_URI" ]]; then \
	  printf '%s\n' 'Set CAM_URI to the published CAM root URI.' >&2; \
	  exit 2; \
	fi; \
	if [[ ! "$$CAM_URI" =~ ^(https|ipfs):// || "$$CAM_URI" == *'$$'* || "$$CAM_URI" == *'`'* ]]; then \
	  printf '%s\n' 'CAM_URI must be an absolute https or ipfs URI without shell substitution syntax.' >&2; \
	  exit 2; \
	fi; \
	$(PACKAGE_DEPS_GUARD); \
	CAM_PREFLIGHT_ROOT_PATH="/work/dapps/$$DAPP/cam/main.json" \
	CAM_PREFLIGHT_ARGS='$(1)' \
	CAM_URI="$$CAM_URI" \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(CAM_PUBLICATION_PREFLIGHT_COMPOSE_FILES) run --build --quiet-build --rm cam-publication-preflight
endef

cam-publication-preflight:
	$(call cam_publication_preflight,)

cam-publication-preflight-json:
	$(call cam_publication_preflight,--json)

cam-publication-preflight-check:
	@$(MAKE) --no-print-directory cam-publication-preflight-json DAPP=bike-nft CAM_URI=https://example.test/bike-nft/cam/main.json >/dev/null

viewer-terminal-check:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml run --build --rm -T viewer-terminal-check

cam-integration-fuzz-check:
	@$(LANE_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(TEST_INTEGRATION_FUZZ_ENV) CAM_INTEGRATION_DESCRIPTOR_HOST_PATH=/dev/null CAM_INTEGRATION_NETWORK=cam-integration-fuzz-check-unused $(DOCKER_COMPOSE) $(TEST_INTEGRATION_FUZZ_COMPOSE_FILES) run --build --rm -T test-integration-fuzz-check

viewer-terminal:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if $(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml ps --all --quiet viewer-terminal | grep -q .; then \
	  printf 'Viewer terminal container already exists: %s\n' "$(VIEWER_TERMINAL_CONTAINER_NAME)" >&2; \
	  printf '%s\n' 'Use make viewer-terminal-attach or make viewer-terminal-down.' >&2; \
	  exit 2; \
	fi; \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml run --build --rm viewer-terminal

viewer-terminal-status:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml ps --all viewer-terminal

viewer-terminal-attach:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml attach viewer-terminal

viewer-terminal-down:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml $(COMPOSE_DOWN_CLEANUP)

checks:
	$(call compose_run,checks.yml,checks)

check-runtime: check-anvil-compose

check-live: check-live-deps-egress

check-live-deps-egress:
	@$(LANE_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from egress-proxy-check egress-proxy-check

check-anvil-compose:
	@$(LANE_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/checks.yml run --build --rm checks -I -B -m unittest discover -s tests/checks -t . -p test_anvil_compose.py

fmt:
	$(call compose_run,forge.yml,forge-fmt)

build: deps-verify
	$(call compose_run,forge.yml,forge-build)

script-build: deps-verify
	$(call compose_run,forge.yml,forge-script-build)

abi: deps-verify
	@$(LANE_GUARD); \
	abi_plan_dir="$$(mktemp -d)"; \
	chmod 0700 "$$abi_plan_dir"; \
	cleanup() { \
	  status="$$?"; \
	  $(COMPOSE_ENV) ABI_PLAN_DIR="$$abi_plan_dir" $(DOCKER_COMPOSE) $(FORGE_ABI_COMPOSE_FILES) $(COMPOSE_DOWN_CLEANUP); \
	  rm -rf "$$abi_plan_dir"; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(COMPOSE_ENV) ABI_PLAN_DIR="$$abi_plan_dir" $(DOCKER_COMPOSE) $(FORGE_ABI_COMPOSE_FILES) run --build --rm forge-abi-plan; \
	$(COMPOSE_ENV) ABI_PLAN_DIR="$$abi_plan_dir" $(DOCKER_COMPOSE) $(FORGE_ABI_COMPOSE_FILES) run --build --rm forge-abi; \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(CAM_COMPOSE_FILES) run --build --rm cam-integrity

cam-integrity:
	@$(LANE_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(CAM_COMPOSE_FILES) run --build --rm cam-integrity

test: deps-verify checks
	$(call compose_run,forge.yml,forge-test)

fuzz: deps-verify
	$(call compose_run,forge.yml,forge-fuzz)

invariant: deps-verify
	$(call compose_run,forge.yml,forge-invariant)

test-integration-fuzz:
	@$(LANE_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if [[ ! -v CAM_INTEGRATION_DESCRIPTOR_HOST_PATH || -z "$$CAM_INTEGRATION_DESCRIPTOR_HOST_PATH" ]]; then \
	  printf '%s\n' 'Set CAM_INTEGRATION_DESCRIPTOR_HOST_PATH to a local descriptor JSON file.' >&2; \
	  exit 2; \
	fi; \
	reject_descriptor_path_symlinks() { \
	  local path="$$1" current part; \
	  if [[ ! -f "$$path" ]]; then \
	    printf 'CAM_INTEGRATION_DESCRIPTOR_HOST_PATH must be a regular file: %s\n' "$$path" >&2; \
	    exit 2; \
	  fi; \
	  if [[ "$$path" = /* ]]; then current="/"; else current="."; fi; \
	  IFS=/ read -r -a parts <<< "$$path"; \
	  for part in "$${parts[@]}"; do \
	    if [[ -z "$$part" || "$$part" = "." ]]; then continue; fi; \
	    if [[ "$$current" = / ]]; then current="/$$part"; else current="$$current/$$part"; fi; \
	    if [[ -L "$$current" ]]; then \
	      printf 'CAM_INTEGRATION_DESCRIPTOR_HOST_PATH must not pass through a symlink: %s\n' "$$path" >&2; \
	      exit 2; \
	    fi; \
	  done; \
	}; \
	reject_descriptor_path_symlinks "$$CAM_INTEGRATION_DESCRIPTOR_HOST_PATH"; \
	if [[ ! -v CAM_INTEGRATION_NETWORK || -z "$$CAM_INTEGRATION_NETWORK" ]]; then \
	  printf '%s\n' 'Set CAM_INTEGRATION_NETWORK to the Docker network that can reach descriptor rpcUrl/resourceOrigin.' >&2; \
	  exit 2; \
	fi; \
	if [[ ! "$$CAM_INTEGRATION_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$$ ]]; then \
	  printf '%s\n' 'CAM_INTEGRATION_NETWORK must be a Docker network name, not a path or shell expression.' >&2; \
	  exit 2; \
	fi; \
	$(TEST_INTEGRATION_FUZZ_ENV) \
	  CAM_INTEGRATION_DESCRIPTOR_HOST_PATH="$${CAM_INTEGRATION_DESCRIPTOR_HOST_PATH}" \
	  CAM_INTEGRATION_NETWORK="$${CAM_INTEGRATION_NETWORK}" \
	  $(DOCKER_COMPOSE) $(TEST_INTEGRATION_FUZZ_COMPOSE_FILES) \
	  run --build --rm test-integration-fuzz

test-integration-fuzz-bike-nft: deps-verify
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  up --build --abort-on-container-exit --exit-code-from test-integration-fuzz-bike-nft test-integration-fuzz-bike-nft

test-integration-fuzz-with-writes-bike-nft: deps-verify
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  up --build --abort-on-container-exit --exit-code-from test-integration-fuzz-with-writes-bike-nft test-integration-fuzz-with-writes-bike-nft

test-integration-fuzz-bike-nft-down:
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP); \
	$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

coverage: deps-verify
	$(call compose_run,forge.yml,forge-coverage)

ci: fmt build script-build test fuzz invariant package-ci

cast-offline:
	$(call compose_run,cast.yml,cast-offline)

cast-rpc:
	@$(LANE_GUARD); \
	if [[ -v RPC_URL && -n "$$RPC_URL" && -v RPC_URL_FILE && -n "$$RPC_URL_FILE" ]]; then \
	  printf '%s\n' 'Set only one of RPC_URL or RPC_URL_FILE.' >&2; \
	  exit 2; \
	fi; \
	reject_rpc_url_file_symlinks() { \
	  path="$${1:?missing RPC URL file path}"; \
	  current="$$(dirname "$$path")"; \
	  while [[ "$$current" != "." && "$$current" != "/" ]]; do \
	    if [[ -L "$$current" ]]; then \
	      printf 'RPC_URL_FILE must not pass through a symlink: %s\n' "$$current" >&2; \
	      exit 2; \
	    fi; \
	    current="$$(dirname "$$current")"; \
	  done; \
	  if [[ -L "$$path" ]]; then \
	    printf 'RPC_URL_FILE must not be a symlink: %s\n' "$$path" >&2; \
	    exit 2; \
	  fi; \
	}; \
	tmp_dir="$$(mktemp -d)"; \
	chmod 0700 "$$tmp_dir"; \
	rpc_url_file="$$tmp_dir/rpc_url"; \
	cleanup() { \
	  status="$$?"; \
	  $(RPC_COMPOSE_ENV) RPC_URL_FILE="$$rpc_url_file" env -u RPC_URL -u MAKEFLAGS -u MFLAGS -u MAKEOVERRIDES $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/cast.yml $(COMPOSE_DOWN_CLEANUP); \
	  rm -rf "$$tmp_dir"; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	if [[ -v RPC_URL_FILE && -n "$$RPC_URL_FILE" ]]; then \
	  reject_rpc_url_file_symlinks "$$RPC_URL_FILE"; \
	  if [[ ! -r "$$RPC_URL_FILE" ]]; then \
	    printf 'RPC_URL_FILE is not readable: %s\n' "$$RPC_URL_FILE" >&2; \
	    exit 2; \
	  fi; \
	  cp -- "$$RPC_URL_FILE" "$$rpc_url_file"; \
	elif [[ -v RPC_URL && -n "$$RPC_URL" ]]; then \
	  printf '%s' "$$RPC_URL" > "$$rpc_url_file"; \
	else \
	  printf '%s\n' 'Set RPC_URL_FILE=/path/to/rpc-url, or set RPC_URL for temporary use.' >&2; \
	  exit 2; \
	fi; \
	chmod 0444 "$$rpc_url_file"; \
	$(RPC_COMPOSE_ENV) RPC_URL_FILE="$$rpc_url_file" env -u RPC_URL -u MAKEFLAGS -u MFLAGS -u MAKEOVERRIDES $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/cast.yml up --build --abort-on-container-exit --exit-code-from cast-rpc cast-rpc

anvil-internal:
	@$(LANE_GUARD); \
	$(ANVIL_INTERNAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil-internal

anvil-host:
	@$(LANE_GUARD); \
	$(ANVIL_HOST_PORT_GUARD); \
	$(ANVIL_HOST_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil-host

anvil-down:
	@$(LANE_GUARD); \
	$(ANVIL_HOST_PORT_GUARD); \
	$(ANVIL_ALL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml down --volumes --remove-orphans

anvil:
	@printf '%s\n' 'Choose an explicit Anvil access boundary: make anvil-internal or make anvil-host.' >&2
	@exit 2

bike-nft-local-deploy: deps-verify
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(CAM_URI_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(BIKE_NFT_LOCAL_COMPOSE_FILES) $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(BIKE_NFT_LOCAL_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from deploy-bike-nft-local deploy-bike-nft-local

bike-nft-viewer-terminal: deps-verify
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES) \
	  run --build --rm bike-nft-viewer-terminal

bike-nft-viewer-terminal-down:
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

bike-nft-viewer-gui: deps-verify
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(BIKE_NFT_GUI_BIND_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	  up --build --detach bike-nft-anvil bike-nft-cam-http; \
	$(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	  run --build --rm --no-deps deploy-bike-nft-local; \
	viewer_url="$$( \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	    run --build --rm --no-deps -T bike-nft-viewer-url \
	)"; \
	printf '\n%s\n\n' "$$viewer_url"; \
	$(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	  up --build --force-recreate --abort-on-container-exit cam-web bike-nft-browser-gateway

bike-nft-viewer-gui-down:
	@$(LANE_GUARD); \
	$(BIKE_NFT_CAM_HASH_GUARD); \
	$(BIKE_NFT_GUI_BIND_GUARD); \
	$(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)
