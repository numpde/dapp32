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
BIKE_NFT_RELEASE_CHECK_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-bike-nft-release-check
ESCROW_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-escrow-local-scenario
ESCROW_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-escrow-viewer-terminal
ESCROW_VIEWER_GUI_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-escrow-viewer-gui
ESCROW_RELEASE_CHECK_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-escrow-release-check
TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-test-integration-fuzz
TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-test-integration-fuzz-bike-nft
TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-test-integration-fuzz-with-writes-bike-nft
BIKE_NFT_GUI_PORT ?= 5173
BIKE_NFT_GUI_BIND_HOST ?= 127.0.0.1
BIKE_NFT_GUI_ORIGIN ?= http://127.0.0.1:$(BIKE_NFT_GUI_PORT)
ESCROW_GUI_PORT ?= 5174
ESCROW_GUI_BIND_HOST ?= 127.0.0.1
ESCROW_GUI_ORIGIN ?= http://127.0.0.1:$(ESCROW_GUI_PORT)
CAM_INTEGRATION_SEED ?= cam-integration-fuzz
CAM_INTEGRATION_RUNS ?= 1
CAM_INTEGRATION_STEPS ?= 16
VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-viewer-terminal
VIEWER_TERMINAL_CONTAINER_NAME ?= $(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME)-session
VIEWER_TERMINAL_MOCK ?= bike-nft
CAM_URI ?=
BIKE_NFT_CAM_HTTP_ORIGIN := http://bike-nft-cam-http:8080
BIKE_NFT_BROADCAST_DIR := /foundry-broadcast
BIKE_NFT_BROADCAST_PATH := $(BIKE_NFT_BROADCAST_DIR)/DeployBikeNftLocal.s.sol/31337/run-latest.json
ESCROW_CAM_HTTP_ORIGIN := http://escrow-cam-http:8080
ESCROW_BROADCAST_DIR := /foundry-broadcast
ESCROW_BROADCAST_PATH := $(ESCROW_BROADCAST_DIR)/DeployEscrowLocal.s.sol/31337/run-latest.json

export ANVIL_HOST_PORT BIKE_NFT_GUI_PORT BIKE_NFT_GUI_BIND_HOST BIKE_NFT_GUI_ORIGIN ESCROW_GUI_PORT ESCROW_GUI_BIND_HOST ESCROW_GUI_ORIGIN
export CAM_INTEGRATION_SEED CAM_INTEGRATION_RUNS CAM_INTEGRATION_STEPS
export LOCAL_UID LOCAL_GID ALLOW_UPDATE
export RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE
export CAM_URI
export VIEWER_TERMINAL_MOCK
COMPOSE_PROJECT_NAME_VARS := COMPOSE_PROJECT_NAME RPC_COMPOSE_PROJECT_NAME ANVIL_COMPOSE_PROJECT_NAME LIVE_CHECK_COMPOSE_PROJECT_NAME BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME BIKE_NFT_RELEASE_CHECK_COMPOSE_PROJECT_NAME ESCROW_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME ESCROW_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ESCROW_VIEWER_GUI_COMPOSE_PROJECT_NAME ESCROW_RELEASE_CHECK_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME VIEWER_TERMINAL_COMPOSE_PROJECT_NAME VIEWER_TERMINAL_CONTAINER_NAME
export $(COMPOSE_PROJECT_NAME_VARS)

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)
DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
PACKAGE_DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
RPC_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_COMPOSE_PROJECT_NAME)
ANVIL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(ANVIL_COMPOSE_PROJECT_NAME)
# The live egress check renders compose/deps.yml but does not install/update
# dependencies; force locked-mode interpolation for unrelated services there.
LIVE_CHECK_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(LIVE_CHECK_COMPOSE_PROJECT_NAME) ALLOW_UPDATE=0
BIKE_NFT_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) BIKE_NFT_BROADCAST_DIR=$(BIKE_NFT_BROADCAST_DIR) BIKE_NFT_BROADCAST_PATH=$(BIKE_NFT_BROADCAST_PATH)
BIKE_NFT_LOCAL_COMPOSE_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME) CAM_URI=$(CAM_URI)
BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME) CAM_URI=$(BIKE_NFT_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(BIKE_NFT_CAM_HTTP_ORIGIN)
BIKE_NFT_VIEWER_GUI_COMPOSE_ENV := $(BIKE_NFT_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME) CAM_URI=$(BIKE_NFT_GUI_ORIGIN)/cam/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(BIKE_NFT_GUI_ORIGIN) BIKE_NFT_GUI_PORT=$(BIKE_NFT_GUI_PORT) BIKE_NFT_GUI_BIND_HOST=$(BIKE_NFT_GUI_BIND_HOST) BIKE_NFT_GUI_ORIGIN=$(BIKE_NFT_GUI_ORIGIN)
BIKE_NFT_RELEASE_CHECK_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(BIKE_NFT_RELEASE_CHECK_COMPOSE_PROJECT_NAME)
ESCROW_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) ESCROW_BROADCAST_DIR=$(ESCROW_BROADCAST_DIR) ESCROW_BROADCAST_PATH=$(ESCROW_BROADCAST_PATH)
ESCROW_LOCAL_SCENARIO_COMPOSE_ENV := $(ESCROW_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(ESCROW_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME) CAM_URI=$(ESCROW_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(ESCROW_CAM_HTTP_ORIGIN)
ESCROW_VIEWER_TERMINAL_COMPOSE_ENV := $(ESCROW_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(ESCROW_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME) CAM_URI=$(ESCROW_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(ESCROW_CAM_HTTP_ORIGIN)
ESCROW_VIEWER_GUI_COMPOSE_ENV := $(ESCROW_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(ESCROW_VIEWER_GUI_COMPOSE_PROJECT_NAME) CAM_URI=$(ESCROW_GUI_ORIGIN)/cam/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(ESCROW_GUI_ORIGIN) ESCROW_GUI_PORT=$(ESCROW_GUI_PORT) ESCROW_GUI_BIND_HOST=$(ESCROW_GUI_BIND_HOST) ESCROW_GUI_ORIGIN=$(ESCROW_GUI_ORIGIN)
ESCROW_RELEASE_CHECK_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(ESCROW_RELEASE_CHECK_COMPOSE_PROJECT_NAME)
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
BIKE_NFT_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml -f $(COMPOSE_DIR)/bike-nft/release/check.yml
BIKE_NFT_RELEASE_DEPLOY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/deploy.yml -f $(COMPOSE_DIR)/bike-nft/release/deploy.yml
BIKE_NFT_RELEASE_VERIFY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/verify.yml -f $(COMPOSE_DIR)/bike-nft/release/verify.yml
ESCROW_LOCAL_SCENARIO_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/deploy.yml -f $(COMPOSE_DIR)/escrow/local/http.yml -f $(COMPOSE_DIR)/escrow/local/scenario.yml
ESCROW_VIEWER_TERMINAL_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/deploy.yml -f $(COMPOSE_DIR)/escrow/local/http.yml -f $(COMPOSE_DIR)/escrow/local/viewer-terminal.yml
ESCROW_VIEWER_GUI_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/deploy.yml -f $(COMPOSE_DIR)/escrow/local/http.yml -f $(COMPOSE_DIR)/escrow/local/viewer-gui.yml
ESCROW_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml -f $(COMPOSE_DIR)/escrow/release/check.yml
ESCROW_RELEASE_DEPLOY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/deploy.yml -f $(COMPOSE_DIR)/escrow/release/deploy.yml
ESCROW_RELEASE_VERIFY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/verify.yml -f $(COMPOSE_DIR)/escrow/release/verify.yml
PAY_TO_PLAY_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml -f $(COMPOSE_DIR)/pay-to-play/release/check.yml
PAY_TO_PLAY_RELEASE_DEPLOY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/deploy.yml -f $(COMPOSE_DIR)/pay-to-play/release/deploy.yml
PAY_TO_PLAY_RELEASE_VERIFY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/verify.yml -f $(COMPOSE_DIR)/pay-to-play/release/verify.yml
export PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID PAY_TO_PLAY_RELEASE_CAM_URI PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD PAY_TO_PLAY_RELEASE_OUTPUT_DIR PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE CONFIRM_PAY_TO_PLAY_RELEASE_DEPLOY
ESCROW_VIEWER_BROWSER_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/browser-check.yml
TEST_INTEGRATION_FUZZ_COMPOSE_FILES := -f $(COMPOSE_DIR)/test/integration-fuzz.yml
TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES := -f $(COMPOSE_DIR)/bike-nft/local/deploy.yml -f $(COMPOSE_DIR)/bike-nft/local/http.yml -f $(COMPOSE_DIR)/bike-nft/local/test-integration-fuzz.yml
# Docker resolves host bind sources before container policy applies. Guard the
# first-party roots in every lane, not only in the repository hygiene checks.
FIRST_PARTY_ROOTS := compose containers dapps docs js tests tools
COMPOSE_PROJECT_NAME_GUARD := for name in $(COMPOSE_PROJECT_NAME_VARS); do value="$${!name:?missing_$$name}"; if [[ ! "$$value" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$$ ]]; then printf '%s must be a Docker-safe name, not a path or shell expression.\n' "$$name" >&2; exit 2; fi; done
NON_ROOT_GUARD := uid="$${LOCAL_UID:?missing_LOCAL_UID}"; gid="$${LOCAL_GID:?missing_LOCAL_GID}"; if [[ ! "$$uid" =~ ^[1-9][0-9]*$$ || ! "$$gid" =~ ^[1-9][0-9]*$$ ]]; then printf '%s\n' 'LOCAL_UID and LOCAL_GID must be positive decimal integers.' >&2; exit 2; fi; if [[ "$(ACTUAL_UID)" == "0" || "$$uid" == "0" ]]; then printf '%s\n' 'Refusing to run Docker lanes as root or with LOCAL_UID=0. Run make as a non-root user.' >&2; exit 2; fi
ALLOW_UPDATE_GUARD := if [[ "$${ALLOW_UPDATE:?missing_ALLOW_UPDATE}" != "0" && "$${ALLOW_UPDATE}" != "1" ]]; then printf '%s\n' 'ALLOW_UPDATE must be 0 or 1.' >&2; exit 2; fi
REPO_SHAPE_GUARD := for path in $(FIRST_PARTY_ROOTS); do if [[ -L "$$path" ]]; then printf 'Refusing Docker lane because first-party root is a symlink: %s\n' "$$path" >&2; exit 2; fi; if [[ -e "$$path" && ! -d "$$path" ]]; then printf 'Refusing Docker lane because first-party root is not a directory: %s\n' "$$path" >&2; exit 2; fi; done; symlink="$$(find $(FIRST_PARTY_ROOTS) \( -path "dapps/dependencies" -o -path "js/node_modules" \) -prune -o -type l -print -quit)"; if [[ -n "$$symlink" ]]; then printf 'Refusing Docker lane because first-party path is a symlink: %s\n' "$$symlink" >&2; exit 2; fi
LANE_GUARD := $(COMPOSE_PROJECT_NAME_GUARD); $(NON_ROOT_GUARD); $(REPO_SHAPE_GUARD)
ANVIL_HOST_PORT_GUARD := port="$${ANVIL_HOST_PORT:?missing_ANVIL_HOST_PORT}"; if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'ANVIL_HOST_PORT must be an integer from 1 to 65535.' >&2; exit 2; fi
BIKE_NFT_GUI_BIND_GUARD := port="$${BIKE_NFT_GUI_PORT:?missing_BIKE_NFT_GUI_PORT}"; host="$${BIKE_NFT_GUI_BIND_HOST:?missing_BIKE_NFT_GUI_BIND_HOST}"; origin="$${BIKE_NFT_GUI_ORIGIN:?missing_BIKE_NFT_GUI_ORIGIN}"; if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'BIKE_NFT_GUI_PORT must be an integer from 1 to 65535.' >&2; exit 2; fi; if [[ "$$host" != "localhost" ]]; then IFS=. read -r a b c d extra <<< "$$host"; for octet in "$$a" "$$b" "$$c" "$$d"; do if [[ -z "$$octet" || ! "$$octet" =~ ^[0-9]{1,3}$$ || "$$octet" -gt 255 ]]; then printf '%s\n' 'BIKE_NFT_GUI_BIND_HOST must be localhost or an IPv4 literal.' >&2; exit 2; fi; done; if [[ -n "$$extra" ]]; then printf '%s\n' 'BIKE_NFT_GUI_BIND_HOST must be localhost or an IPv4 literal.' >&2; exit 2; fi; fi; if [[ ! "$$origin" =~ ^https?://[^:/@?\#]+(:[1-9][0-9]{0,4})?$$ || "$$origin" == *'$$'* || "$$origin" == *'`'* || "$$origin" == *\\* || "$$origin" == *\"* || "$$origin" == *\'* || "$$origin" == *\;* || "$$origin" == *\#* ]]; then printf '%s\n' 'BIKE_NFT_GUI_ORIGIN must be an http(s) origin without credentials, path, query, fragment, invalid port, or shell syntax.' >&2; exit 2; fi; if [[ "$$origin" =~ :([1-9][0-9]{0,4})$$ ]]; then origin_port="$${BASH_REMATCH[1]}"; if [[ "$$origin_port" -gt 65535 ]]; then printf '%s\n' 'BIKE_NFT_GUI_ORIGIN port must be an integer from 1 to 65535.' >&2; exit 2; fi; fi
ESCROW_GUI_BIND_GUARD := port="$${ESCROW_GUI_PORT:?missing_ESCROW_GUI_PORT}"; host="$${ESCROW_GUI_BIND_HOST:?missing_ESCROW_GUI_BIND_HOST}"; origin="$${ESCROW_GUI_ORIGIN:?missing_ESCROW_GUI_ORIGIN}"; if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'ESCROW_GUI_PORT must be an integer from 1 to 65535.' >&2; exit 2; fi; if [[ "$$host" != "localhost" ]]; then IFS=. read -r a b c d extra <<< "$$host"; for octet in "$$a" "$$b" "$$c" "$$d"; do if [[ -z "$$octet" || ! "$$octet" =~ ^[0-9]{1,3}$$ || "$$octet" -gt 255 ]]; then printf '%s\n' 'ESCROW_GUI_BIND_HOST must be localhost or an IPv4 literal.' >&2; exit 2; fi; done; if [[ -n "$$extra" ]]; then printf '%s\n' 'ESCROW_GUI_BIND_HOST must be localhost or an IPv4 literal.' >&2; exit 2; fi; fi; if [[ ! "$$origin" =~ ^https?://[^:/@?\#]+(:[1-9][0-9]{0,4})?$$ || "$$origin" == *'$$'* || "$$origin" == *'`'* || "$$origin" == *\\* || "$$origin" == *\"* || "$$origin" == *\'* || "$$origin" == *\;* || "$$origin" == *\#* ]]; then printf '%s\n' 'ESCROW_GUI_ORIGIN must be an http(s) origin without credentials, path, query, fragment, invalid port, or shell syntax.' >&2; exit 2; fi; if [[ "$$origin" =~ :([1-9][0-9]{0,4})$$ ]]; then origin_port="$${BASH_REMATCH[1]}"; if [[ "$$origin_port" -gt 65535 ]]; then printf '%s\n' 'ESCROW_GUI_ORIGIN port must be an integer from 1 to 65535.' >&2; exit 2; fi; fi
CAM_RESOURCE_OUTPUT_GUARD := if [[ ! -f docs/reference/cam/1.2.0/index.html ]]; then printf '%s\n' 'CAM protocol reference must be an existing regular file: docs/reference/cam/1.2.0/index.html' >&2; exit 2; fi; for cam_path in dapps/bike-nft/cam/{main.json,protocol.html} dapps/escrow/cam/{main.json,protocol.html} dapps/pay-to-play/cam/{main.json,protocol.html}; do if [[ ! -f "$$cam_path" ]]; then printf 'CAM output must be an existing regular file: %s\n' "$$cam_path" >&2; exit 2; fi; done
CAM_URI_GUARD := uri="$${CAM_URI?missing_CAM_URI}"; if [[ -z "$$uri" ]]; then printf '%s\n' 'Set CAM_URI to the CAM document URI for the local fixture.' >&2; exit 2; fi; if [[ ! "$$uri" =~ ^(https?|ipfs):// || "$$uri" == *'$$'* || "$$uri" == *'`'* || "$$uri" == *\"* || "$$uri" == *\'* || "$$uri" == *\;* ]]; then printf '%s\n' 'CAM_URI must be an absolute http(s) or ipfs URI without shell syntax.' >&2; exit 2; fi
CAM_INTEGRATION_INPUT_GUARD := seed="$${CAM_INTEGRATION_SEED:?missing_CAM_INTEGRATION_SEED}"; runs="$${CAM_INTEGRATION_RUNS:?missing_CAM_INTEGRATION_RUNS}"; steps="$${CAM_INTEGRATION_STEPS:?missing_CAM_INTEGRATION_STEPS}"; if [[ ! "$$seed" =~ ^[A-Za-z0-9_.:-]{1,128}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_SEED must be 1-128 URL-safe label characters.' >&2; exit 2; fi; if [[ ! "$$runs" =~ ^[1-9][0-9]{0,3}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_RUNS must be a positive decimal integer under 10000.' >&2; exit 2; fi; if [[ ! "$$steps" =~ ^[1-9][0-9]{0,3}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_STEPS must be a positive decimal integer under 10000.' >&2; exit 2; fi
VIEWER_TERMINAL_MOCK_GUARD := if [[ ! "$${VIEWER_TERMINAL_MOCK:?missing_VIEWER_TERMINAL_MOCK}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$$ ]]; then printf '%s\n' 'VIEWER_TERMINAL_MOCK must be a mock name, not a path or shell expression.' >&2; exit 2; fi
# Intentional default: cleanup handlers intentionally ignore Compose teardown
# failure so the user sees the primary lane failure. Do not use this outside
# best-effort cleanup paths where the original status is preserved separately.
COMPOSE_DOWN_CLEANUP := down --volumes --remove-orphans >/dev/null 2>&1 || true

define release_require_clean_source
if [[ -n "$$(git status --porcelain --untracked-files=all)" ]]; then \
  printf '%s requires a clean Git working tree.\n' "$(1)" >&2; \
  exit 2; \
fi; \
source_commit="$$(GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify HEAD)"; \
if [[ ! "$$source_commit" =~ ^[0-9a-f]{40}$$ ]]; then \
  printf '%s\n' 'Could not resolve one exact lowercase 40-character source commit.' >&2; \
  exit 2; \
fi
endef

define release_validate_cam_uri
cam_uri="$${$(1)_RELEASE_CAM_URI}"; \
if [[ -v RELEASE_REHEARSAL && "$$RELEASE_REHEARSAL" == "1" ]]; then \
  if [[ "$$cam_uri" != "http://release-cam:8080/$(2)/main.json" ]]; then printf '%s\n' 'Local rehearsal requires its exact private CAM URI.' >&2; exit 2; fi; \
elif [[ ! "$$cam_uri" =~ ^(https|ipfs):// ]]; then \
  printf '%s\n' '$(1)_RELEASE_CAM_URI must be an absolute HTTPS or IPFS URI.' >&2; exit 2; \
fi; \
if [[ "$$cam_uri" == *'$$'* || "$$cam_uri" == *'`'* || "$$cam_uri" == *\\* || "$$cam_uri" == *\"* || "$$cam_uri" == *\'* || "$$cam_uri" == *\;* ]]; then \
  printf '%s\n' '$(1)_RELEASE_CAM_URI must not contain shell syntax.' >&2; exit 2; \
fi
endef

define release_host_guard_functions
reject_release_path_symlinks() { \
  local path="$$1" label="$$2" current="/" part; \
  local -a parts; \
  IFS=/ read -r -a parts <<< "$$path"; \
  for part in "$${parts[@]}"; do \
    if [[ -z "$$part" ]]; then continue; fi; \
    if [[ "$$current" == "/" ]]; then current="/$$part"; else current="$$current/$$part"; fi; \
    if [[ -L "$$current" ]]; then \
      printf '%s must not pass through a symlink.\n' "$$label" >&2; \
      exit 2; \
    fi; \
  done; \
}; \
require_release_file() { \
  local path="$$1" label="$$2"; \
  if [[ "$$path" != /* ]]; then printf '%s must be an absolute path.\n' "$$label" >&2; exit 2; fi; \
  reject_release_path_symlinks "$$path" "$$label"; \
  if [[ ! -f "$$path" || ! -r "$$path" ]]; then \
    printf '%s must be a readable regular file.\n' "$$label" >&2; \
    exit 2; \
  fi; \
}; \
require_protected_release_file() { \
  local path="$$1" label="$$2" permission_label="$$3"; \
  require_release_file "$$path" "$$label"; \
  if [[ -n "$$(find "$$path" -maxdepth 0 -perm /077 -print -quit)" ]]; then \
    printf '%s must not be group- or world-accessible.\n' "$$permission_label" >&2; \
    exit 2; \
  fi; \
}; \
require_release_rpc_input() { \
  rpc_api_key_file=""; \
  if [[ -v RPC_URL_FILE && -n "$$RPC_URL_FILE" ]]; then \
    for name in RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE; do \
      if [[ -v $$name && -n "$${!name}" ]]; then printf '%s\n' 'Choose RPC_URL_FILE or RPC_CHAIN plus RPC_SERVICE, not both.' >&2; exit 2; fi; \
    done; \
    require_protected_release_file "$$RPC_URL_FILE" "RPC_URL_FILE" "RPC_URL_FILE"; \
  else \
    if [[ ! -v RPC_CHAIN || -z "$$RPC_CHAIN" || ! -v RPC_SERVICE || -z "$$RPC_SERVICE" ]]; then \
      printf '%s\n' 'Set RPC_URL_FILE, or select RPC_CHAIN and RPC_SERVICE; run make release/rpc/list.' >&2; exit 2; \
    fi; \
    if [[ -v RPC_API_KEY_FILE && -n "$$RPC_API_KEY_FILE" ]]; then \
      require_protected_release_file "$$RPC_API_KEY_FILE" "RPC_API_KEY_FILE" "RPC_API_KEY_FILE"; rpc_api_key_file="$$RPC_API_KEY_FILE"; \
    fi; \
  fi; \
}; \
validate_new_release_output() { \
  local path="$$1" label="$$2" parent repository_root; \
  if [[ "$$path" != /* || "$$(realpath -m -- "$$path")" != "$$path" ]]; then \
    printf '%s must be a normalized absolute path.\n' "$$label" >&2; \
    exit 2; \
  fi; \
  if [[ -e "$$path" || -L "$$path" ]]; then \
    printf '%s must not already exist.\n' "$$label" >&2; \
    exit 2; \
  fi; \
  parent="$$(dirname -- "$$path")"; \
  reject_release_path_symlinks "$$parent" "$$label parent"; \
  if [[ ! -d "$$parent" ]]; then \
    printf '%s parent must be an existing directory.\n' "$$label" >&2; \
    exit 2; \
  fi; \
  repository_root="$$(pwd -P)"; \
  case "$$path" in "$$repository_root"|"$$repository_root"/*) \
    printf '%s must be outside the repository.\n' "$$label" >&2; \
    exit 2 ;; \
  esac; \
}; \
recheck_new_release_output() { \
  local path="$$1" label="$$2" parent; \
  parent="$$(dirname -- "$$path")"; \
  reject_release_path_symlinks "$$parent" "$$label parent"; \
  if [[ ! -d "$$parent" || -e "$$path" || -L "$$path" ]]; then \
    printf '%s changed while the release snapshot was being checked.\n' "$$label" >&2; \
    exit 2; \
  fi; \
}
endef

define release_snapshot_allocate
ceremony_root="$$(mktemp -d "/tmp/cam-release-$${LOCAL_UID:?missing_LOCAL_UID}-XXXXXXXX")"; \
chmod 0700 "$$ceremony_root"; \
ceremony_digest="$$(printf '%s' "$$ceremony_root" | sha256sum)"; \
ceremony_project="cam-release-$${ceremony_digest:0:24}"; \
ceremony_source="$$ceremony_root/source"
endef

define release_snapshot_populate
mkdir --mode=0700 -- "$$ceremony_source"; \
GIT_NO_REPLACE_OBJECTS=1 git archive --format=tar --output="$$ceremony_root/source.tar" "$$source_commit"; \
tar --extract --file="$$ceremony_root/source.tar" --directory="$$ceremony_source"; \
rm -f -- "$$ceremony_root/source.tar"; \
cp -a -- "$(DEPENDENCIES_DIR)" "$$ceremony_source/$(DEPENDENCIES_DIR)"; \
cp -a -- "$(PACKAGE_NODE_MODULES_DIR)" "$$ceremony_source/$(PACKAGE_NODE_MODULES_DIR)"
endef

define release_snapshot_cleanup
status="$$?"; \
set +e; \
cleanup_failed=0; \
if [[ "$$release_run_started" == "1" ]] && ! compose_release down --rmi local --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'Release run teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$release_check_started" == "1" ]] && ! compose_release_check down --rmi local --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'Release check teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$release_dependencies_started" == "1" ]] && ! compose_release_dependencies down --rmi local --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'Release dependency-check teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$release_rpc_started" == "1" ]] && ! compose_release_rpc down --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'RPC resolver teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ -n "$$ceremony_root" ]]; then \
  case "$$ceremony_root" in "/tmp/cam-release-$${LOCAL_UID:?missing_LOCAL_UID}-"*) \
      if [[ "$$cleanup_failed" == "0" ]] && ! rm -rf -- "$$ceremony_root"; then cleanup_failed=1; fi ;; \
    *) printf 'Refusing to remove unexpected release ceremony path: %s\n' "$$ceremony_root" >&2; cleanup_failed=1 ;; \
  esac; \
fi; \
if [[ "$$cleanup_failed" != "0" ]]; then \
  if [[ -n "$$ceremony_root" ]]; then printf 'Release cleanup is incomplete; retained path for inspection: %s\n' "$$ceremony_root" >&2; fi; \
  if [[ "$$status" == "0" ]]; then status=1; fi; \
fi; \
trap - EXIT; \
exit "$$status"
endef

define release_snapshot_dependency_compose
compose_release_dependencies() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-deps" ALLOW_UPDATE=0 \
    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) -f "$$ceremony_source/compose/deps.yml" "$$@"; \
}
endef

# Every release phase uses these files from the archived commit, including overlays.
release_snapshot_compose_args = $(foreach file,$(filter-out -f,$(1)),-f "$$ceremony_source/$(file)")
ifeq ($(RELEASE_REHEARSAL),1)
release_compose_files = $(1) -f $(COMPOSE_DIR)/release/rehearsal-$(2).yml
else
release_compose_files = $(1)
endif

define release_resolve_rpc
if [[ ! -v RPC_URL_FILE || -z "$$RPC_URL_FILE" ]]; then \
  mkdir --mode=0700 -- "$$ceremony_root/rpc"; \
  rpc_key_args=(); \
  rpc_key_input() { if [[ -n "$$rpc_api_key_file" ]]; then head -c 258 -- "$$rpc_api_key_file"; fi; }; \
  if [[ -n "$$rpc_api_key_file" ]]; then rpc_key_args=(--api-key-stdin); fi; \
  release_rpc_started=1; \
  rpc_key_input | compose_release_rpc run --rm --no-deps -T rpc-resolve "$$RPC_CHAIN" "$$RPC_SERVICE" /out/rpc-url "$$release_rpc_expected_chain" "$${rpc_key_args[@]}"; \
  RPC_URL_FILE="$$ceremony_root/rpc/rpc-url"; \
fi
endef

define release_rpc_compose
compose_release_rpc() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-rpc" \
    RELEASE_RPC_OUTPUT_DIR="$$ceremony_root/rpc" env -u PRIVATE_KEY -u RPC_URL \
    $(DOCKER_COMPOSE) -f "$$ceremony_source/compose/release/rpc.yml" "$$@"; \
}
endef

define release_prepare_snapshot
$(release_snapshot_dependency_compose); \
$(release_rpc_compose); \
ceremony_root=""; release_rpc_started=0; release_dependencies_started=0; release_check_started=0; release_run_started=0; \
cleanup() { $(release_snapshot_cleanup); }; \
trap cleanup EXIT; \
$(release_snapshot_allocate); \
$(release_snapshot_populate); \
$(release_resolve_rpc); \
release_dependencies_started=1; \
compose_release_dependencies run --build --rm soldeer-verify
endef

define release_deploy_execution
release_rpc_expected_chain="$$chain_id"; \
$(release_prepare_snapshot); \
release_check_started=1; \
compose_release_check run --build --rm release-check; \
recheck_new_release_output "$$output_dir" "$(1)"; \
mkdir --mode=0700 -- "$$output_dir"; \
mkdir --mode=0700 -- "$$output_dir/plan" "$$output_dir/broadcast" "$$output_dir/artifact"; \
release_run_started=1; \
compose_release up --build --abort-on-container-exit --exit-code-from release-artifact release-artifact; \
printf 'Release artifact: %s/artifact/deployment.json\n' "$$output_dir"
endef

define release_verify_execution
release_rpc_expected_chain=""; \
$(release_prepare_snapshot); \
release_run_started=1; \
compose_release up --build --abort-on-container-exit --exit-code-from verify-release verify-release
endef

define compose_run
@$(LANE_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

PACKAGE_DEPS_GUARD := if [[ -L "$(PACKAGE_NODE_MODULES_DIR)" || -L "$(PACKAGE_LOCK_FILE)" ]]; then printf '%s\n' 'Refusing package lane because node_modules or package-lock.json is a symlink.' >&2; exit 2; fi; if [[ ! -d "$(PACKAGE_NODE_MODULES_DIR)" || ! -f "$(PACKAGE_LOCK_FILE)" ]]; then printf '%s\n' 'Missing npm workspace dependencies. Run make js/deps/install to install the locked package dependencies.' >&2; exit 2; fi
SOLDEER_DEPS_GUARD := if [[ -L "$(DEPENDENCIES_DIR)" || -L "$(FOUNDRY_MANIFEST_FILE)" ]]; then printf '%s\n' 'Refusing Soldeer lane because dapps/dependencies or dapps/foundry.toml is a symlink.' >&2; exit 2; fi; if [[ ! -d "$(DEPENDENCIES_DIR)" || ! -f "$(FOUNDRY_MANIFEST_FILE)" ]]; then printf '%s\n' 'Missing Soldeer dependencies. Run make dapps/deps/install to install the locked Solidity dependencies.' >&2; exit 2; fi; for file in $(DEPENDENCY_METADATA_FILES); do if [[ -L "$$file" ]]; then printf 'Refusing Soldeer lane because metadata file is a symlink: %s\n' "$$file" >&2; exit 2; fi; if [[ ! -f "$$file" ]]; then printf 'Missing Soldeer metadata: %s\n' "$$file" >&2; exit 2; fi; done

define compose_run_with_package_deps
@$(LANE_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

.PHONY: wallet/addresses wallet/addresses/check release/rpc/list release/local/rehearsal/run release/local/rehearsal/check help dapps/deps/install dapps/deps/verify js/deps/install js/deps/graph/check js/build/check js/tests js/ci cam/conformance/check cam/publication/preflight cam/publication/preflight/json cam/publication/preflight/check viewer/terminal/check cam/integration/fuzz/check bike-nft/release/check bike-nft/release/deploy bike-nft/release/verify escrow/release/check escrow/release/deploy escrow/release/verify tests/checks tests/live tests/live/dependency-egress viewer/terminal/mock/up viewer/terminal/mock/status viewer/terminal/mock/attach viewer/terminal/mock/down tests/checks/anvil-compose dapps/format dapps/format/check dapps/build dapps/scripts/build cam/abi/export cam/integrity/refresh dapps/tests/unit-scenario dapps/tests/fuzz dapps/tests/invariant cam/live/integration/fuzz/run bike-nft/local/integration/fuzz/run bike-nft/local/integration/fuzz/fixture-writes/run bike-nft/local/integration/fuzz/down dapps/tests/coverage ci cast/offline/check cast/live/block-number/read anvil/internal/up anvil/host/up anvil/down bike-nft/local/deploy bike-nft/local/demo/terminal/up bike-nft/local/demo/terminal/down bike-nft/local/demo/gui/up bike-nft/local/demo/gui/down escrow/local/scenario/run escrow/local/demo/terminal/up escrow/local/demo/terminal/down escrow/local/demo/gui/up escrow/local/demo/gui/down escrow/live/browser/check dapps/tests tests

help:
	@printf '%s\n' \
	  'Usage: make <target> [NAME=value ...]' \
	  '  make help   Show all supported commands, inputs and effects below.' \
	  '  Run from this checkout as a non-root user with Docker and Docker Compose.' \
	  '  Build/test commands run in containers. Install their locked dependencies first.' \
	  '  Offline means the check itself has no external network access; image builds may need it.' \
	  '' \
	  'Install dependencies (downloads packages and writes the installed dependency tree):' \
	  '  make dapps/deps/install          Install locked Solidity dependencies into dapps/dependencies/.' \
	  '  make js/deps/install             Install locked JS dependencies into js/node_modules/.' \
	  '    Add ALLOW_UPDATE=1 to either install only when updating its lock metadata is intended.' \
	  '    Solidity updates also rewrite remappings/checksums; JS updates rewrite js/package-lock.json.' \
	  '  make dapps/deps/verify           Check installed Solidity files against committed checksums.' \
	  '  make js/deps/graph/check         Check installed JS packages against the lockfile offline.' \
	  '' \
	  'Choose checks and tests:' \
	  '  make tests                      Run all self-contained tests, including external network checks' \
	  '                                  and disposable fixture deployments; cleanup runs on exit.' \
	  '  make ci                         Run offline Solidity formatting/build/tests and JS CI checks.' \
	  '  make tests/checks               Check repository rules, source files and rendered Compose settings.' \
	  '  make tests/checks/anvil-compose  Check only the Anvil container configuration.' \
	  '  make tests/live                 Run checks that contact external services; no operator deployment needed.' \
	  '  make tests/live/dependency-egress  Test which download destinations dependency containers can reach.' \
	  '  make dapps/tests                Run Solidity unit/scenario tests, random-input tests and state invariants.' \
	  '  make dapps/tests/unit-scenario   Run Solidity unit/scenario tests plus repository checks.' \
	  '  make dapps/tests/fuzz            Exercise Solidity functions with generated inputs.' \
	  '  make dapps/tests/invariant       Check Solidity invariants across generated transaction sequences.' \
	  '  make dapps/tests/coverage        Run Solidity unit/scenario tests and print source coverage.' \
	  '  make js/tests                   Build, typecheck and test JS workspace packages and apps offline.' \
	  '  make js/ci                      Run js/tests plus the terminal, publication, fuzz and release/refund tool checks.' \
	  '  make cam/conformance/check      Check local CAM manifests and their ABI/UI resources against protocol rules.' \
	  '  make viewer/terminal/check      Test the terminal viewer with simulated contract responses offline.' \
	  '  make cam/publication/preflight/check  Test publication validation using the local Bike NFT bundle.' \
	  '  make cam/integration/fuzz/check  Build, typecheck and test the generated-workflow test runner offline.' \
	  '  make bike-nft/release/check      Typecheck and test Bike NFT deployment/verification tools offline.' \
	  '  make pay-to-play/release/check   Typecheck and test Pay-to-Play deployment/verification tools offline.' \
	  '  make escrow/release/check        Typecheck and test Escrow deployment/verification tools offline.' \
	  '  make pay-to-play/refunds/check   Typecheck and test the refund worker offline.' \
	  '  make wallet/addresses           Prompt privately for a MetaMask phrase; print accounts 1-10 and paths.' \
	  '    Input and derivation run offline in a local Foundry container; remote Docker endpoints are rejected.' \
	  '    Wait for the Recovery phrase prompt, then enter or paste the 12 words on one line.' \
	  '    Only public addresses are printed, never private keys.' \
	  '    The hidden 12-word phrase uses a temporary RAM-backed file, removed on exit; no host files are written.' \
	  '  make wallet/addresses/check     Test derivation and terminal handling with a public fixture phrase.' \
	  '  make cast/offline/check         Check Foundry cast commands without contacting a blockchain.' \
	  '' \
	  'Compile or update repository files:' \
	  '  make js/build/check             Compile JS workspace packages/apps; keep outputs inside the container.' \
	  '  make dapps/build                Compile Solidity contracts; keep outputs inside the container.' \
	  '  make dapps/scripts/build        Compile deployment scripts without deploying contracts.' \
	  '  make dapps/format/check          Check Solidity formatting without changing files.' \
	  '  make dapps/format DAPP=escrow     Rewrite Solidity formatting in one app directory.' \
	  '    DAPP is a directory name under dapps/, such as bike-nft, escrow or pay-to-play.' \
	  '  make cam/abi/export             Rewrite declared ABI JSON from compiled contracts, copy protocol pages,' \
	  '                                  and refresh manifest hashes for the resulting resource bytes.' \
	  '  make cam/integrity/refresh       Copy the versioned protocol page and rewrite ABI/UI/protocol hashes.' \
	  '' \
	  'Try an app on a temporary blockchain:' \
	  '  Install both Solidity and JS dependencies for these demos.' \
	  '  They use local chain 31337 and public test accounts.' \
	  '  Each up command stays in the terminal; exiting attempts to remove its chain and all demo state.' \
	  '  Browser demos print a URL: open it yourself and keep the command running.' \
	  '  make bike-nft/local/demo/gui/up       Start the Bike NFT browser demo at http://127.0.0.1:5173.' \
	  '  make bike-nft/local/demo/gui/down     Stop that demo and remove its temporary state.' \
	  '  make escrow/local/demo/gui/up         Start the Escrow browser demo at http://127.0.0.1:5174.' \
	  '  make escrow/local/demo/gui/down       Stop that demo and remove its temporary state.' \
	  '  make pay-to-play/local/demo/gui/up    Start the Pay-to-Play browser demo at http://127.0.0.1:5175.' \
	  '  make pay-to-play/local/demo/gui/down  Stop that demo and remove its temporary state.' \
	  '    Change a port with BIKE_NFT_GUI_PORT, ESCROW_GUI_PORT or PAY_TO_PLAY_GUI_PORT.' \
	  '    For access from another machine, set BIKE_NFT_GUI_BIND_HOST=0.0.0.0 and BIKE_NFT_GUI_ORIGIN' \
	  '    to its browser-visible http://hostname:port; Escrow uses ESCROW_GUI_BIND_HOST/ESCROW_GUI_ORIGIN.' \
	  '    Pay-to-Play remains loopback-only.' \
	  '  make bike-nft/local/demo/terminal/up    Deploy Bike NFT and use its interactive terminal viewer.' \
	  '  make bike-nft/local/demo/terminal/down  Stop that terminal demo and remove its temporary state.' \
	  '  make escrow/local/demo/terminal/up     Deploy Escrow and use its interactive terminal viewer.' \
	  '  make escrow/local/demo/terminal/down   Stop that terminal demo and remove its temporary state.' \
	  '    Demo/scenario containers use COMPOSE_PROJECT_NAME=dapps by default.' \
	  '    Choose another COMPOSE_PROJECT_NAME for parallel runs; reuse it for the matching down command.' \
	  '    Parallel browser demos also need different host ports.' \
	  '' \
	  'Run the terminal viewer with no blockchain:' \
	  '  make viewer/terminal/mock/up      Start an interactive viewer with simulated responses.' \
	  '    VIEWER_TERMINAL_MOCK=bike-nft is the only supported simulated backend.' \
	  '    up occupies the terminal; quitting the viewer removes its container.' \
	  '  make viewer/terminal/mock/status  Show whether that viewer container still exists.' \
	  '  make viewer/terminal/mock/attach  Reattach to that existing viewer.' \
	  '  make viewer/terminal/mock/down    Stop and remove that viewer container.' \
	  '' \
	  'Give another test runner a temporary Pay-to-Play deployment:' \
	  '  make pay-to-play/local/fixture/up FIXTURE_ID=my-test    Deploy and leave the chain running in the background.' \
	  '  make pay-to-play/local/fixture/info FIXTURE_ID=my-test  Print verified connection details as JSON.' \
	  '  make pay-to-play/local/fixture/down FIXTURE_ID=my-test  Stop only that deployment and delete its state.' \
	  '    FIXTURE_ID is your name for one test deployment, not an on-chain channel ID.' \
	  '    Reuse the same ID for up/info/down; choose a fresh ID for each parallel test.' \
	  '    FIXTURE_ID alone selects these deployments; COMPOSE_PROJECT_NAME does not change that selection.' \
	  '    IDs allow 1-48 lowercase letters, digits, underscores or hyphens; start with a letter or digit.' \
	  '    up rejects existing IDs. info includes an internal Docker network, RPC URL, deployed addresses' \
	  '    and public test keys. Attach test containers to that network; no RPC port is exposed on the host.' \
	  '    Stop attached test containers before down. Only Solidity dependencies are needed here.' \
	  '    Setup and JSON fields: dapps/pay-to-play/README.md, local deployment section.' \
	  '' \
	  'Exercise app workflows on disposable local deployments (removed when each command exits):' \
	  '  make escrow/local/scenario/run       Run the Escrow workflows through the contract-driven viewer.' \
	  '  make pay-to-play/local/scenario/run  Test deposits, vouchers, collection and withdrawals through the viewer.' \
	  '  make pay-to-play/local/recovery/run  Also test recovery deadlines, retirement and the refund CLI.' \
	  '  make bike-nft/local/deploy CAM_URI=URI  Test a Bike NFT deployment, then remove it.' \
	  '    URI must be the absolute HTTP(S) or IPFS address to record for the CAM manifest.' \
	  '  make bike-nft/local/integration/fuzz/run  Walk generated CAM workflows and simulate transactions.' \
	  '  make bike-nft/local/integration/fuzz/fixture-writes/run  Also submit transactions on its disposable chain.' \
	  '  make bike-nft/local/integration/fuzz/down  Remove leftovers from either local workflow test.' \
	  '' \
	  'Exercise an existing CAM deployment without submitting transactions:' \
	  '  make cam/live/integration/fuzz/run' \
	  '    Set CAM_INTEGRATION_DESCRIPTOR_HOST_PATH to the connection JSON file and CAM_INTEGRATION_NETWORK' \
	  '    to an existing Docker network that reaches its RPC and resource server.' \
	  '    JSON fields: camIntegration="1.0.0", chainId, rpcUrl, camHost, resourceOrigin and accounts.' \
	  '    accounts is an array containing exactly one address.' \
	  '    chainId is an eip155:* string; camHost is the CAM host address; accounts selects one viewing address.' \
	  '    rpcUrl is its HTTP(S) RPC URL; resourceOrigin is the allowed HTTP(S) origin for CAM resources.' \
	  '    Prepare that JSON yourself; it differs from the connection JSON emitted by fixture/info.' \
	  '    Workflow-test defaults: CAM_INTEGRATION_SEED=cam-integration-fuzz, CAM_INTEGRATION_RUNS=1,' \
	  '    CAM_INTEGRATION_STEPS=16. These control reproducibility, run count and steps per run.' \
	  '    Run counts must be 1-100; steps per run must be 1-1000.' \
	  '' \
	  'Check an already-running local browser demo:' \
	  '  Start the demo and a browser with remote debugging enabled; these commands start neither.' \
	  '  For Chromium, enable --remote-debugging-port=9222 with a separate --user-data-dir.' \
	  '  Set CDP_ORIGIN to its debugging HTTP origin, for example http://127.0.0.1:9222.' \
	  '  Set VIEWER_URL to the full URL printed by the demo; EXPECTED_CAM_URI is its manifest URL.' \
	  '  EXPECTED_CAM_HASH is the manifest SHA-256 digest from the contract, as 0x plus 64 hex digits.' \
	  '  Read the URI/hash from camManifest() on the CAM host address in VIEWER_URL.' \
	  '  Each check opens and closes its own test tab; it leaves the browser and demo running.' \
	  '  make escrow/live/browser/check                 Check read/navigation/error states without signed transactions.' \
	  '  make escrow/live/browser/fixture-writes/check  Send signed local transactions and test wallet failures.' \
	  '  make pay-to-play/live/browser/check            Send signed local transactions and test payment/recovery workflows.' \
	  '    These two checks change demo state and spend local test coins on gas.' \
	  '  make viewer/local/fixture-wallet/attach        Sign and send transactions requested by an existing demo tab.' \
	  '    For attach, also set FIXTURE_WALLET_APP=escrow or pay-to-play, CDP_TARGET_ID to that existing tab ID,' \
	  '    and EXPECTED_CONTRACT_ADDRESS to the payment/escrow contract address. Keep attach running.' \
	  '    The app README gives the contract binding and full browser setup commands.' \
	  '    Confirming a Send prompt in the browser immediately signs and submits that local transaction.' \
	  '    Find tab IDs at the debugging origin /json/list. The signer is for local chain 31337 only.' \
	  '' \
	  'Sign a local Pay-to-Play voucher without sending it:' \
	  '  make pay-to-play/local/voucher/sign' \
	  '    Set PAY_TO_PLAY_ADDRESS to the deployed payment contract and PAY_TO_PLAY_TOTAL to the cumulative' \
	  '    authorized amount in wei. PAY_TO_PLAY_INVOICE_HASH is 0x plus 64 hex digits.' \
	  '    PAY_TO_PLAY_CHANNEL_ID defaults to 1. Prints a signature using the public fixture customer key' \
	  '    and chain 31337; it neither registers a voucher key nor submits payment.' \
	  '    Use the channel ID returned by channel creation. Collection requires that position to have' \
	  '    registered the fixture customer address as its voucher key.' \
	  '    Invoice hash construction and signing steps: js/tools/pay-to-play-vouchers/README.md.' \
	  '' \
	  'Plan or execute Pay-to-Play refunds on an existing deployment:' \
	  '  make pay-to-play/refunds/plan     Read due refunds and print the bounded plan; send no transactions.' \
	  '  make pay-to-play/refunds/run      Submit refund transactions, pay gas and write the transaction journal.' \
	  '    Both require REFUND_CONFIG_FILE (deployment/channel, scan limits and fee/transaction budgets)' \
	  '    and RPC_URL_FILE (a file containing the RPC URL). Use absolute files with owner-only permissions.' \
	  '    run also requires REFUND_PRIVATE_KEY_FILE (relayer key), CONFIRM_PAY_TO_PLAY_REFUNDS=YES,' \
	  '    and REFUND_STATE_DIR: an existing directory outside the repo, owned by you, with mode 0700.' \
	  '    Keep that directory for safe retries. Configuration examples: js/tools/pay-to-play-refunds/README.md.' \
	  '' \
	  'Prepare CAM publication (validate local files; no upload or contract deployment):' \
	  '  make cam/publication/preflight DAPP=escrow CAM_URI=URI       Print CAM_HASH for the local bundle.' \
	  '  make cam/publication/preflight/json DAPP=escrow CAM_URI=URI  Print the validation result as JSON.' \
	  '    DAPP names the folder under dapps/. URI is the intended absolute HTTPS/IPFS manifest address.' \
	  '    Validation reads the local bundle, not a downloaded copy. Publish those exact bytes separately.' \
	  '' \
	  'Deploy or verify a release on an operator-selected blockchain:' \
	  '  make release/rpc/list             List selectable network names, chain IDs and RPC URL templates.' \
	  '  make release/local/rehearsal/check  Rehearse releases for all three supported apps.' \
	  '  make release/local/rehearsal/run DAPP=pay-to-play  Test that same release workflow on an isolated local chain.' \
	  '    DAPP must be bike-nft, escrow or pay-to-play. Requires installed locked dependencies.' \
	  '    It tests current source, including uncommitted changes, through a private committed snapshot.' \
	  '    It deploys through the normal commands, checks pending handoffs fail verification, accepts them,' \
	  '    loads CAM from its recorded URI, and verifies again. Bike admin waits use the local chain clock.' \
	  '    It uses public test keys, private HTTP transport and no host ports or external network.' \
	  '    Temporary services are removed; records remain at the printed /tmp/cam-release-rehearsal-* path.' \
	  '  make bike-nft/release/deploy      Send Bike NFT deployment transactions and save deployment records.' \
	  '  make escrow/release/deploy        Send Escrow deployment transactions and save deployment records.' \
	  '  make pay-to-play/release/deploy   Send Pay-to-Play deployment transactions and save deployment records.' \
	  '    These require a clean checkout, installed Solidity/JS dependencies, a funded deployer, an expected chain ID,' \
	  '    published CAM URI, intended owners, and a new absolute output directory outside the repository.' \
	  '    Select RPC_CHAIN and RPC_SERVICE=public|alchemy; make release/rpc/list lists the catalog.' \
	  '    Alchemy also requires RPC_API_KEY_FILE, an absolute owner-only file containing its API key.' \
	  '    Or use RPC_URL_FILE for a custom HTTPS URL; do not mix it with catalog inputs.' \
	  '    DEPLOYER_PRIVATE_KEY_FILE contains the deployer key; RPC catalog use does not supply funds or keys.' \
	  '    All credential files must be absolute and owner-only. Confirm with CONFIRM_BIKE_NFT_RELEASE_DEPLOY=YES' \
	  '    or CONFIRM_ESCROW_RELEASE_DEPLOY=YES or CONFIRM_PAY_TO_PLAY_RELEASE_DEPLOY=YES after reviewing all settings.' \
	  '    Required Pay-to-Play settings:' \
	  '      PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID        Target chain number; 1337 and 31337 are excluded.' \
	  '      PAY_TO_PLAY_RELEASE_CAM_URI                  Published HTTPS/IPFS manifest URI.' \
	  '      PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER  Intended owner of the CAM host.' \
	  '      PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN   Intended admin of the payment contract; may differ.' \
	  '      PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD        Reserved-channel withdrawal wait in seconds, 0-2592000.' \
	  '      PAY_TO_PLAY_RELEASE_OUTPUT_DIR               New absolute directory outside this repository.' \
	  '    Required Escrow settings:' \
	  '      ESCROW_RELEASE_EXPECTED_CHAIN_ID       Target chain number; 1337 and 31337 are excluded.' \
	  '      ESCROW_RELEASE_CAM_URI                 Published HTTPS/IPFS manifest URI.' \
	  '      ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER  Intended owner address for the CAM host contract.' \
	  '      ESCROW_RELEASE_OUTPUT_DIR              New absolute directory outside this repository.' \
	  '    Required Bike NFT settings:' \
	  '      BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID       Target chain number; 1337 and 31337 are excluded.' \
	  '      BIKE_NFT_RELEASE_CAM_URI                 Published HTTPS/IPFS manifest URI.' \
	  '      BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER  Intended owner address for the CAM host contract.' \
	  '      BIKE_NFT_RELEASE_TOKEN_NAME              Collection name displayed to users.' \
	  '      BIKE_NFT_RELEASE_TOKEN_SYMBOL            Short collection symbol.' \
	  '      BIKE_NFT_RELEASE_BASE_TOKEN_URI          URI prefix for individual token metadata.' \
	  '      BIKE_NFT_RELEASE_COLLECTION_URI          URI for collection metadata.' \
	  '      BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN  Intended admin address for the component NFTs.' \
	  '      BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY     Positive admin-transfer waiting period in seconds.' \
	  '      BIKE_NFT_RELEASE_COMPONENTS_PAUSER          Address allowed to pause/resume component NFTs.' \
	  '      BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER      Address allowed to change metadata URI settings.' \
	  '      BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN     Intended admin address for the component manager.' \
	  '      BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY        Positive admin-transfer waiting period in seconds.' \
	  '      BIKE_NFT_RELEASE_MANAGER_PAUSER             Address allowed to pause/resume the manager.' \
	  '      BIKE_NFT_RELEASE_MANAGER_CONFIGURER         Address allowed to set token contract/delegation limit.' \
	  '      BIKE_NFT_RELEASE_REGISTRARS              Comma-separated unique nonzero registrar addresses.' \
	  '      BIKE_NFT_RELEASE_OUTPUT_DIR              New absolute directory outside this repository.' \
	  '    Copyable commands: each app README under dapps/, release section.' \
	  '    Every lasting Bike NFT authority must differ from the funded deployer.' \
	  '    The output directory retains plans, broadcasts and deployment records, including partial failures.' \
	  '    Requested new owners/admins must accept their transfers separately; Bike admin transfers have a wait.' \
	  '    CAM host owners and Pay-to-Play admins call acceptOwnership() on their respective contracts.' \
	  '    Each new Bike admin calls acceptDefaultAdminTransfer().' \
	  '    Use the saved deployment addresses and acceptance instructions in the app release README.' \
	  '    Deployment records pending transfers. Run release/verify after the intended owners accept them.' \
	  '  make bike-nft/release/verify      Read the chain and compare it with the saved Bike NFT deployment.' \
	  '    Select RPC as above; set BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE to the absolute deployment JSON path.' \
	  '  make escrow/release/verify        Read the chain and compare it with the saved Escrow deployment.' \
	  '    Select RPC as above; set ESCROW_DEPLOYMENT_ARTIFACT_FILE to the absolute deployment JSON path.' \
	  '  make pay-to-play/release/verify   Read the chain and compare it with the saved Pay-to-Play deployment.' \
	  '    Select RPC as above; set PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE to the absolute deployment JSON path.' \
	  '    Verification needs a clean checkout and installed Solidity/JS dependencies; it sends no transactions.' \
	  '    Custom RPC URL files and API-key files must also have owner-only permissions.' \
	  '    Deployment record layout and file rules: docs/release-ceremony.md.' \
	  '' \
	  'Run a bare local blockchain or query a block number:' \
	  '  make anvil/internal/up           Run Anvil for Docker peers only; publish no host port.' \
	  '  make anvil/host/up               Run Anvil at 127.0.0.1:8545; override with ANVIL_HOST_PORT.' \
	  '    Both stay in the foreground and deploy no app. Use another terminal for down.' \
	  '    COMPOSE_PROJECT_NAME also selects these chains; reuse it for down, which removes both variants.' \
	  '  make anvil/down                 Remove these Anvil containers, their network and any volumes.' \
	  '  make cast/live/block-number/read RPC_URL_FILE=/absolute/path/to/rpc-url' \
	  '    Read the current block number through a public HTTPS RPC endpoint on port 443.' \
	  '    RPC_URL_FILE is a file containing that URL.' \
	  '    Alternatively set RPC_URL in the environment; the command copies it to a temporary file.' \
	  '    Supply only one URL source. This query sends no transaction.'

dapps/deps/install:
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
	        printf '%s\n' 'Run make dapps/deps/install ALLOW_UPDATE=1 only if creating or updating dependency metadata is intended.' >&2; \
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

dapps/deps/verify:
	@$(LANE_GUARD); \
	$(ALLOW_UPDATE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify

js/deps/install:
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
	      printf '%s\n' 'Run make js/deps/install ALLOW_UPDATE=1 only if creating or updating package metadata is intended.' >&2; \
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

js/deps/graph/check:
	$(call compose_run_with_package_deps,packages.yml,package-graph-check)

js/build/check:
	$(call compose_run_with_package_deps,packages.yml,package-build-check)

js/tests:
	$(call compose_run_with_package_deps,packages.yml,package-test)

js/ci: js/tests viewer/terminal/check cam/publication/preflight/check cam/integration/fuzz/check bike-nft/release/check escrow/release/check pay-to-play/release/check pay-to-play/refunds/check

cam/conformance/check:
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

cam/publication/preflight:
	$(call cam_publication_preflight,)

cam/publication/preflight/json:
	$(call cam_publication_preflight,--json)

cam/publication/preflight/check:
	@$(MAKE) --no-print-directory cam/publication/preflight/json DAPP=bike-nft CAM_URI=https://example.test/bike-nft/cam/main.json >/dev/null

viewer/terminal/check:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml run --build --rm -T viewer-terminal-check

cam/integration/fuzz/check:
	@$(LANE_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(TEST_INTEGRATION_FUZZ_ENV) CAM_INTEGRATION_DESCRIPTOR_HOST_PATH=/dev/null CAM_INTEGRATION_NETWORK=cam-integration-fuzz-check-unused $(DOCKER_COMPOSE) $(TEST_INTEGRATION_FUZZ_COMPOSE_FILES) run --build --rm -T test-integration-fuzz-check

pay-to-play/release/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(PAY_TO_PLAY_RELEASE_CHECK_COMPOSE_FILES) run --build --rm release-check

escrow/release/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(ESCROW_RELEASE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(ESCROW_RELEASE_CHECK_COMPOSE_FILES) run --build --rm -T release-check

bike-nft/release/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(BIKE_NFT_RELEASE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(BIKE_NFT_RELEASE_CHECK_COMPOSE_FILES) run --build --rm -T release-check

viewer/terminal/mock/up:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if $(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml ps --all --quiet viewer-terminal | grep -q .; then \
	  printf 'Viewer terminal container already exists: %s\n' "$(VIEWER_TERMINAL_CONTAINER_NAME)" >&2; \
	  printf '%s\n' 'Use make viewer/terminal/mock/attach or make viewer/terminal/mock/down.' >&2; \
	  exit 2; \
	fi; \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml run --build --rm viewer-terminal

viewer/terminal/mock/status:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml ps --all viewer-terminal

viewer/terminal/mock/attach:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml attach viewer-terminal

viewer/terminal/mock/down:
	@$(LANE_GUARD); \
	$(VIEWER_TERMINAL_MOCK_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml $(COMPOSE_DOWN_CLEANUP)

tests/checks:
	$(call compose_run,checks.yml,checks)

tests/live: tests/live/dependency-egress

tests/live/dependency-egress:
	@$(LANE_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from egress-proxy-check egress-proxy-check

tests/checks/anvil-compose:
	@$(LANE_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/checks.yml run --build --rm checks -I -B -m unittest discover -s tests/checks -t . -p test_anvil_compose.py

dapps/format:
	@$(LANE_GUARD); \
	if [[ ! -v DAPP ]]; then \
	  printf '%s\n' 'Set DAPP to a first-level dapp directory, for example: make dapps/format DAPP=escrow' >&2; \
	  exit 2; \
	fi; \
	if [[ -z "$$DAPP" ]]; then \
	  printf '%s\n' 'Set DAPP to a first-level dapp directory, for example: make dapps/format DAPP=escrow' >&2; \
	  exit 2; \
	fi; \
	if [[ ! "$$DAPP" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$$ ]]; then \
	  printf '%s\n' 'DAPP must be a first-level dapp directory name, not a path or shell expression.' >&2; \
	  exit 2; \
	fi; \
	dapp_dir="$(DAPPS_DIR)/$$DAPP"; \
	if [[ ! -d "$$dapp_dir" ]]; then \
	  printf 'DAPP does not name an existing first-level dapp directory: %s\n' "$$DAPP" >&2; \
	  exit 2; \
	fi; \
	has_solidity_sources=0; \
	for source_kind in src test script; do \
	  if [[ -d "$$dapp_dir/$$source_kind" ]]; then \
	    has_solidity_sources=1; \
	  fi; \
	done; \
	if [[ "$$has_solidity_sources" -eq 0 ]]; then \
	  printf 'DAPP has no Solidity src, test, or script directory: %s\n' "$$DAPP" >&2; \
	  exit 2; \
	fi; \
	format_stage_dir="$$(mktemp -d)"; \
	chmod 0700 "$$format_stage_dir"; \
	cleanup() { \
	  status="$$?"; \
	  rm -rf "$$format_stage_dir"; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/forge.yml run --build --rm \
	  --env "DAPP=$$DAPP" \
	  --volume "$$format_stage_dir:/format-output:rw" \
	  forge-fmt \
	  sh -eu -c 'staged_dapp="/format-output/$$DAPP"; mkdir -p "$$staged_dapp"; set --; for source_kind in src test script; do source_dir="$$DAPP/$$source_kind"; if [ -d "$$source_dir" ]; then staged_dir="$$staged_dapp/$$source_kind"; mkdir -p "$$staged_dir"; cp -R "$$source_dir/." "$$staged_dir/"; set -- "$$@" "$$staged_dir"; fi; done; forge fmt "$$@"'; \
	for source_kind in src test script; do \
	  staged_dir="$$format_stage_dir/$$DAPP/$$source_kind"; \
	  if [[ -d "$$staged_dir" ]]; then \
	    cp -R "$$staged_dir/." "$$dapp_dir/$$source_kind/"; \
	  fi; \
	done

dapps/format/check:
	$(call compose_run,forge.yml,forge-fmt)

dapps/build: dapps/deps/verify
	$(call compose_run,forge.yml,forge-build)

dapps/scripts/build: dapps/deps/verify
	$(call compose_run,forge.yml,forge-script-build)

cam/abi/export: dapps/deps/verify
	@$(LANE_GUARD); \
	$(CAM_RESOURCE_OUTPUT_GUARD); \
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

cam/integrity/refresh:
	@$(LANE_GUARD); \
	$(CAM_RESOURCE_OUTPUT_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(CAM_COMPOSE_FILES) run --build --rm cam-integrity

dapps/tests/unit-scenario: dapps/deps/verify tests/checks
	$(call compose_run,forge.yml,forge-test)

dapps/tests/fuzz: dapps/deps/verify
	$(call compose_run,forge.yml,forge-fuzz)

dapps/tests/invariant: dapps/deps/verify
	$(call compose_run,forge.yml,forge-invariant)

cam/live/integration/fuzz/run:
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

bike-nft/local/integration/fuzz/run: dapps/deps/verify
	@$(LANE_GUARD); \
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

bike-nft/local/integration/fuzz/fixture-writes/run: dapps/deps/verify
	@$(LANE_GUARD); \
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

bike-nft/local/integration/fuzz/down:
	@$(LANE_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	$(TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP); \
	$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

dapps/tests/coverage: dapps/deps/verify
	$(call compose_run,forge.yml,forge-coverage)

dapps/tests: dapps/tests/unit-scenario dapps/tests/fuzz dapps/tests/invariant

tests: tests/checks dapps/tests js/ci tests/live cast/offline/check wallet/addresses/check pay-to-play/local/recovery/run escrow/local/scenario/run bike-nft/local/integration/fuzz/run bike-nft/local/integration/fuzz/fixture-writes/run release/local/rehearsal/check

release/rpc/list:
	@cat tools/rpc-catalog.json

release/local/rehearsal/check:
	@for app in bike-nft escrow pay-to-play; do $(MAKE) release/local/rehearsal/run DAPP="$$app" RPC_URL_FILE=/must-not-use-parent-rpc DEPLOYER_PRIVATE_KEY_FILE=/must-not-use-parent-key || exit "$$?"; done

release/local/rehearsal/run:
	@$(LANE_GUARD); $(SOLDEER_DEPS_GUARD); $(PACKAGE_DEPS_GUARD); \
	bash tools/release_rehearsal.sh "$${DAPP:?Set DAPP to bike-nft, escrow or pay-to-play}" "$(DOCKER_COMPOSE)"

ci: wallet/addresses/check dapps/format/check dapps/build dapps/scripts/build dapps/tests/unit-scenario dapps/tests/fuzz dapps/tests/invariant js/ci

# Pin the checked local daemon so ambient contexts cannot receive mnemonic input.
define wallet_compose
if [[ -v DOCKER_CONTEXT && -n "$$DOCKER_CONTEXT" ]]; then \
  wallet_endpoint="$$(env -u DOCKER_HOST docker context inspect --format '{{ .Endpoints.docker.Host }}' "$$DOCKER_CONTEXT")"; \
elif [[ -v DOCKER_HOST && -n "$$DOCKER_HOST" ]]; then \
  wallet_endpoint="$$DOCKER_HOST"; \
else \
  wallet_endpoint="$$(docker context inspect --format '{{ .Endpoints.docker.Host }}')"; \
fi; \
if [[ "$$wallet_endpoint" != unix:///* || ! -S "$${wallet_endpoint#unix://}" ]]; then \
  printf '%s\n' 'Wallet derivation requires a local Docker Unix socket; remote Docker endpoints are not allowed.' >&2; exit 2; \
fi; \
$(COMPOSE_ENV) env -u DOCKER_CONTEXT -u DOCKER_HOST docker --host "$$wallet_endpoint" compose --env-file /dev/null -f $(COMPOSE_DIR)/cast.yml $(1)
endef

wallet/addresses:
	@$(LANE_GUARD); \
	if [[ ! -t 0 || ! -t 1 ]]; then printf '%s\n' 'Run make wallet/addresses in an interactive terminal.' >&2; exit 2; fi; \
	$(call wallet_compose,run --build --rm --no-deps wallet-addresses)

wallet/addresses/check:
	@$(LANE_GUARD); \
	$(call wallet_compose,run --build --rm --no-deps -T wallet-addresses-check)

cast/offline/check:
	$(call compose_run,cast.yml,cast-offline)

cast/live/block-number/read:
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

anvil/internal/up:
	@$(LANE_GUARD); \
	$(ANVIL_INTERNAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil-internal

anvil/host/up:
	@$(LANE_GUARD); \
	$(ANVIL_HOST_PORT_GUARD); \
	$(ANVIL_HOST_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil-host

anvil/down:
	@$(LANE_GUARD); \
	$(ANVIL_HOST_PORT_GUARD); \
	$(ANVIL_ALL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml down --volumes --remove-orphans

bike-nft/local/deploy: dapps/deps/verify
	@$(LANE_GUARD); \
	$(CAM_URI_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(BIKE_NFT_LOCAL_COMPOSE_FILES) $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(BIKE_NFT_LOCAL_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from deploy-bike-nft-local deploy-bike-nft-local

bike-nft/local/demo/terminal/up: dapps/deps/verify
	@$(LANE_GUARD); \
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

bike-nft/local/demo/terminal/down:
	@$(LANE_GUARD); \
	$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

bike-nft/local/demo/gui/up: dapps/deps/verify
	@$(LANE_GUARD); \
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

bike-nft/local/demo/gui/down:
	@$(LANE_GUARD); \
	$(BIKE_NFT_GUI_BIND_GUARD); \
	$(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

escrow/local/scenario/run: dapps/deps/verify
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(ESCROW_LOCAL_SCENARIO_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(ESCROW_LOCAL_SCENARIO_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(ESCROW_LOCAL_SCENARIO_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_LOCAL_SCENARIO_COMPOSE_FILES) \
	  up --build --abort-on-container-exit --exit-code-from escrow-local-scenario escrow-local-scenario

escrow/local/demo/terminal/up: dapps/deps/verify
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(ESCROW_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(ESCROW_VIEWER_TERMINAL_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(ESCROW_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_TERMINAL_COMPOSE_FILES) \
	  run --build --rm escrow-viewer-terminal

escrow/local/demo/terminal/down:
	@$(LANE_GUARD); \
	$(ESCROW_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_TERMINAL_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

escrow/local/demo/gui/up: dapps/deps/verify
	@$(LANE_GUARD); \
	$(ESCROW_GUI_BIND_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(ESCROW_VIEWER_GUI_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_GUI_COMPOSE_FILES) \
	  up --build --detach escrow-anvil escrow-cam-http; \
	$(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_GUI_COMPOSE_FILES) \
	  run --build --rm --no-deps deploy-escrow-local; \
	viewer_url="$$( \
	  $(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(ESCROW_VIEWER_GUI_COMPOSE_FILES) \
	    run --build --rm --no-deps -T escrow-viewer-url \
	)"; \
	printf '\n%s\n\n' "$$viewer_url"; \
	$(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_GUI_COMPOSE_FILES) \
	  up --build --force-recreate --abort-on-container-exit cam-web escrow-browser-gateway

escrow/local/demo/gui/down:
	@$(LANE_GUARD); \
	$(ESCROW_GUI_BIND_GUARD); \
	$(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_GUI_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)

# Explicit live browser check: host networking reaches the operator's loopback
# CDP, GUI, and RPC endpoints and grants ordinary host-network egress. The
# runner validates its direct URLs; the external browser fetches public CAM.
# This lane never starts or stops the GUI or browser.
escrow/live/browser/check:
	@$(LANE_GUARD); \
	CDP_ORIGIN="$${CDP_ORIGIN:?Set CDP_ORIGIN}" VIEWER_URL="$${VIEWER_URL:?Set VIEWER_URL}" \
	EXPECTED_CAM_URI="$${EXPECTED_CAM_URI:?Set EXPECTED_CAM_URI}" EXPECTED_CAM_HASH="$${EXPECTED_CAM_HASH:?Set EXPECTED_CAM_HASH}" \
	$(DOCKER_COMPOSE) $(ESCROW_VIEWER_BROWSER_CHECK_COMPOSE_FILES) run --rm --no-deps -T escrow-viewer-browser-check

# Distinct opt-in fixture-write grant. Existing readonly browser check remains
# dependency-free; this runner consumes locked viem through the workspace gate.
.PHONY: escrow/live/browser/fixture-writes/check
escrow/live/browser/fixture-writes/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	CDP_ORIGIN="$${CDP_ORIGIN:?Set CDP_ORIGIN}" VIEWER_URL="$${VIEWER_URL:?Set VIEWER_URL}" \
	EXPECTED_CAM_URI="$${EXPECTED_CAM_URI:?Set EXPECTED_CAM_URI}" EXPECTED_CAM_HASH="$${EXPECTED_CAM_HASH:?Set EXPECTED_CAM_HASH}" \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(ESCROW_VIEWER_BROWSER_CHECK_COMPOSE_FILES) run --build --rm --no-deps -T escrow-viewer-browser-write-check

escrow/release/deploy:
	@$(LANE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if [[ ! -v CONFIRM_ESCROW_RELEASE_DEPLOY || "$$CONFIRM_ESCROW_RELEASE_DEPLOY" != "YES" ]]; then \
	  printf '%s\n' 'Set CONFIRM_ESCROW_RELEASE_DEPLOY=YES only after reviewing the chain, CAM publication, final owner, and funded deployer.' >&2; \
	  exit 2; \
	fi; \
	$(call release_require_clean_source,Escrow release deployment); \
	for name in ESCROW_RELEASE_EXPECTED_CHAIN_ID ESCROW_RELEASE_CAM_URI ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER DEPLOYER_PRIVATE_KEY_FILE ESCROW_RELEASE_OUTPUT_DIR; do \
	  if [[ ! -v $$name || -z "$${!name}" ]]; then \
	    printf 'Missing required release input: %s\n' "$$name" >&2; \
	    exit 2; \
	  fi; \
	done; \
	chain_id="$$ESCROW_RELEASE_EXPECTED_CHAIN_ID"; \
	if [[ ! "$$chain_id" =~ ^[1-9][0-9]*$$ || "$$chain_id" == "1337" || "$$chain_id" == "31337" ]]; then \
	  printf '%s\n' 'ESCROW_RELEASE_EXPECTED_CHAIN_ID must be a positive non-fixture chain ID.' >&2; \
	  exit 2; \
	fi; \
	$(call release_validate_cam_uri,ESCROW,escrow); \
	owner="$$ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER"; \
	if [[ ! "$$owner" =~ ^0x[0-9a-fA-F]{40}$$ || "$$owner" == "0x0000000000000000000000000000000000000000" ]]; then \
	  printf '%s\n' 'ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER must be a nonzero EVM address.' >&2; \
	  exit 2; \
	fi; \
	$(release_host_guard_functions); \
	require_release_rpc_input; \
	require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" "DEPLOYER_PRIVATE_KEY_FILE" "$$DEPLOYER_PRIVATE_KEY_FILE"; \
	output_dir="$$ESCROW_RELEASE_OUTPUT_DIR"; \
	validate_new_release_output "$$output_dir" "ESCROW_RELEASE_OUTPUT_DIR"; \
	compose_release() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
	    RELEASE_OUTPUT_DIR="$$output_dir" \
	    ESCROW_RELEASE_CAM_URI="$$cam_uri" \
	    ESCROW_RELEASE_EXPECTED_CHAIN_ID="$$chain_id" \
	    ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER="$$owner" \
	    ESCROW_RELEASE_SOURCE_COMMIT="$$source_commit" \
	    RPC_URL_FILE="$$RPC_URL_FILE" \
	    DEPLOYER_PRIVATE_KEY_FILE="$$DEPLOYER_PRIVATE_KEY_FILE" \
	    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(call release_compose_files,$(ESCROW_RELEASE_DEPLOY_COMPOSE_FILES),deploy)) "$$@"; \
	}; \
	compose_release_check() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-check" \
	    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(ESCROW_RELEASE_CHECK_COMPOSE_FILES)) "$$@"; \
	}; \
	$(call release_deploy_execution,ESCROW_RELEASE_OUTPUT_DIR)

escrow/release/verify:
	@$(LANE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(call release_require_clean_source,Escrow release verification); \
	for name in ESCROW_DEPLOYMENT_ARTIFACT_FILE; do \
	  if [[ ! -v $$name || -z "$${!name}" ]]; then \
	    printf 'Missing required verification input: %s\n' "$$name" >&2; \
	    exit 2; \
	  fi; \
	done; \
	$(release_host_guard_functions); \
	require_release_rpc_input; \
	require_release_file "$$ESCROW_DEPLOYMENT_ARTIFACT_FILE" "ESCROW_DEPLOYMENT_ARTIFACT_FILE"; \
	compose_release() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
	    RPC_URL_FILE="$$RPC_URL_FILE" \
	    RELEASE_DEPLOYMENT_ARTIFACT_FILE="$$ESCROW_DEPLOYMENT_ARTIFACT_FILE" \
	    ESCROW_RELEASE_EXPECTED_SOURCE_COMMIT="$$source_commit" \
	    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(call release_compose_files,$(ESCROW_RELEASE_VERIFY_COMPOSE_FILES),verify)) "$$@"; \
	}; \
	$(release_verify_execution)

bike-nft/release/deploy:
	@$(LANE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if [[ ! -v CONFIRM_BIKE_NFT_RELEASE_DEPLOY || "$$CONFIRM_BIKE_NFT_RELEASE_DEPLOY" != "YES" ]]; then \
	  printf '%s\n' 'Set CONFIRM_BIKE_NFT_RELEASE_DEPLOY=YES only after reviewing every authority, delay, URI, chain, and registrar.' >&2; exit 2; \
	fi; \
	$(call release_require_clean_source,Bike NFT release deployment); \
	required=(BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID BIKE_NFT_RELEASE_CAM_URI BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER BIKE_NFT_RELEASE_TOKEN_NAME BIKE_NFT_RELEASE_TOKEN_SYMBOL BIKE_NFT_RELEASE_BASE_TOKEN_URI BIKE_NFT_RELEASE_COLLECTION_URI BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY BIKE_NFT_RELEASE_COMPONENTS_PAUSER BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY BIKE_NFT_RELEASE_MANAGER_PAUSER BIKE_NFT_RELEASE_MANAGER_CONFIGURER BIKE_NFT_RELEASE_REGISTRARS DEPLOYER_PRIVATE_KEY_FILE BIKE_NFT_RELEASE_OUTPUT_DIR); \
	for name in "$${required[@]}"; do if [[ ! -v $$name || -z "$${!name}" ]]; then printf 'Missing required Bike NFT release input: %s\n' "$$name" >&2; exit 2; fi; done; \
	chain_id="$$BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID"; \
	if [[ ! "$$chain_id" =~ ^[1-9][0-9]*$$ || "$$chain_id" == 1337 || "$$chain_id" == 31337 ]]; then printf '%s\n' 'BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID must be a positive non-fixture chain ID.' >&2; exit 2; fi; \
	$(call release_validate_cam_uri,BIKE_NFT,bike-nft); \
	$(release_host_guard_functions); \
	require_release_rpc_input; \
	require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" "DEPLOYER_PRIVATE_KEY_FILE" "$$DEPLOYER_PRIVATE_KEY_FILE"; \
	output_dir="$$BIKE_NFT_RELEASE_OUTPUT_DIR"; \
	validate_new_release_output "$$output_dir" "BIKE_NFT_RELEASE_OUTPUT_DIR"; \
	compose_release() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" RELEASE_OUTPUT_DIR="$$output_dir" BIKE_NFT_RELEASE_SOURCE_COMMIT="$$source_commit" \
	  BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID="$$chain_id" BIKE_NFT_RELEASE_CAM_URI="$$cam_uri" \
	  BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER="$$BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER" BIKE_NFT_RELEASE_TOKEN_NAME="$$BIKE_NFT_RELEASE_TOKEN_NAME" BIKE_NFT_RELEASE_TOKEN_SYMBOL="$$BIKE_NFT_RELEASE_TOKEN_SYMBOL" \
	  BIKE_NFT_RELEASE_BASE_TOKEN_URI="$$BIKE_NFT_RELEASE_BASE_TOKEN_URI" BIKE_NFT_RELEASE_COLLECTION_URI="$$BIKE_NFT_RELEASE_COLLECTION_URI" \
	  BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN="$$BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN" BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY="$$BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY" BIKE_NFT_RELEASE_COMPONENTS_PAUSER="$$BIKE_NFT_RELEASE_COMPONENTS_PAUSER" BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER="$$BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER" \
	  BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN="$$BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN" BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY="$$BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY" BIKE_NFT_RELEASE_MANAGER_PAUSER="$$BIKE_NFT_RELEASE_MANAGER_PAUSER" BIKE_NFT_RELEASE_MANAGER_CONFIGURER="$$BIKE_NFT_RELEASE_MANAGER_CONFIGURER" BIKE_NFT_RELEASE_REGISTRARS="$$BIKE_NFT_RELEASE_REGISTRARS" \
	  RPC_URL_FILE="$$RPC_URL_FILE" DEPLOYER_PRIVATE_KEY_FILE="$$DEPLOYER_PRIVATE_KEY_FILE" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(call release_compose_files,$(BIKE_NFT_RELEASE_DEPLOY_COMPOSE_FILES),deploy)) "$$@"; \
	}; \
	compose_release_check() { LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-check" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(BIKE_NFT_RELEASE_CHECK_COMPOSE_FILES)) "$$@"; }; \
	$(call release_deploy_execution,BIKE_NFT_RELEASE_OUTPUT_DIR)

bike-nft/release/verify:
	@$(LANE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(call release_require_clean_source,Bike NFT release verification); \
	for name in BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE; do if [[ ! -v $$name || -z "$${!name}" ]]; then printf 'Missing required verification input: %s\n' "$$name" >&2; exit 2; fi; done; \
	$(release_host_guard_functions); \
	require_release_rpc_input; \
	require_release_file "$$BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE" "BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE"; \
	compose_release() { LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" RPC_URL_FILE="$$RPC_URL_FILE" RELEASE_DEPLOYMENT_ARTIFACT_FILE="$$BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE" BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT="$$source_commit" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(call release_compose_files,$(BIKE_NFT_RELEASE_VERIFY_COMPOSE_FILES),verify)) "$$@"; }; \
	$(release_verify_execution)

.PHONY: pay-to-play/release/check pay-to-play/release/deploy pay-to-play/release/verify
pay-to-play/release/deploy:
	@$(LANE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if [[ ! -v CONFIRM_PAY_TO_PLAY_RELEASE_DEPLOY || "$$CONFIRM_PAY_TO_PLAY_RELEASE_DEPLOY" != "YES" ]]; then \
	  printf '%s\n' 'Set CONFIRM_PAY_TO_PLAY_RELEASE_DEPLOY=YES only after reviewing the chain, CAM publication, both authorities, withdrawal wait, and funded deployer.' >&2; \
	  exit 2; \
	fi; \
	$(call release_require_clean_source,Pay-to-Play release deployment); \
	for name in PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID PAY_TO_PLAY_RELEASE_CAM_URI PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD DEPLOYER_PRIVATE_KEY_FILE PAY_TO_PLAY_RELEASE_OUTPUT_DIR; do \
	  if [[ ! -v $$name || -z "$${!name}" ]]; then \
	    printf 'Missing required release input: %s\n' "$$name" >&2; \
	    exit 2; \
	  fi; \
	done; \
	chain_id="$$PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID"; \
	if [[ ! "$$chain_id" =~ ^[1-9][0-9]*$$ || "$$chain_id" == "1337" || "$$chain_id" == "31337" ]]; then \
	  printf '%s\n' 'PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID must be a positive non-fixture chain ID.' >&2; \
	  exit 2; \
	fi; \
	$(call release_validate_cam_uri,PAY_TO_PLAY,pay-to-play); \
	owner="$$PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER"; \
	if [[ ! "$$owner" =~ ^0x[0-9a-fA-F]{40}$$ || "$$owner" == "0x0000000000000000000000000000000000000000" ]]; then \
	  printf '%s\n' 'PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER must be a nonzero EVM address.' >&2; \
	  exit 2; \
	fi; \
	$(release_host_guard_functions); \
	require_release_rpc_input; \
	require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" "DEPLOYER_PRIVATE_KEY_FILE" "$$DEPLOYER_PRIVATE_KEY_FILE"; \
	output_dir="$$PAY_TO_PLAY_RELEASE_OUTPUT_DIR"; \
	validate_new_release_output "$$output_dir" "PAY_TO_PLAY_RELEASE_OUTPUT_DIR"; \
	compose_release() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
	    RELEASE_OUTPUT_DIR="$$output_dir" \
	    PAY_TO_PLAY_RELEASE_CAM_URI="$$cam_uri" \
	    PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID="$$chain_id" \
	    PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER="$$owner" \
	    PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN="$$PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN" \
	    PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD="$$PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD" \
	    PAY_TO_PLAY_RELEASE_SOURCE_COMMIT="$$source_commit" \
	    RPC_URL_FILE="$$RPC_URL_FILE" \
	    DEPLOYER_PRIVATE_KEY_FILE="$$DEPLOYER_PRIVATE_KEY_FILE" \
	    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(call release_compose_files,$(PAY_TO_PLAY_RELEASE_DEPLOY_COMPOSE_FILES),deploy)) "$$@"; \
	}; \
	compose_release_check() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-check" \
	    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(PAY_TO_PLAY_RELEASE_CHECK_COMPOSE_FILES)) "$$@"; \
	}; \
	$(call release_deploy_execution,PAY_TO_PLAY_RELEASE_OUTPUT_DIR)

pay-to-play/release/verify:
	@$(LANE_GUARD); \
	$(SOLDEER_DEPS_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(call release_require_clean_source,Pay-to-Play release verification); \
	for name in PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE; do \
	  if [[ ! -v $$name || -z "$${!name}" ]]; then \
	    printf 'Missing required verification input: %s\n' "$$name" >&2; \
	    exit 2; \
	  fi; \
	done; \
	$(release_host_guard_functions); \
	require_release_rpc_input; \
	require_release_file "$$PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE" "PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE"; \
	compose_release() { \
	  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
	    RPC_URL_FILE="$$RPC_URL_FILE" \
	    RELEASE_DEPLOYMENT_ARTIFACT_FILE="$$PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE" \
	    PAY_TO_PLAY_RELEASE_EXPECTED_SOURCE_COMMIT="$$source_commit" \
	    env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(call release_compose_files,$(PAY_TO_PLAY_RELEASE_VERIFY_COMPOSE_FILES),verify)) "$$@"; \
	}; \
	$(release_verify_execution)

# Disposable payment-channel fixture. Its scenario and browser projects are isolated.
PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-pay-to-play-local-scenario
PAY_TO_PLAY_VIEWER_GUI_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-pay-to-play-viewer-gui
PAY_TO_PLAY_GUI_PORT ?= 5175
PAY_TO_PLAY_GUI_BIND_HOST ?= 127.0.0.1
PAY_TO_PLAY_GUI_ORIGIN ?= http://127.0.0.1:$(PAY_TO_PLAY_GUI_PORT)
PAY_TO_PLAY_CAM_HTTP_ORIGIN := http://pay-to-play-cam-http:8080
PAY_TO_PLAY_BROADCAST_DIR := /foundry-broadcast
PAY_TO_PLAY_BROADCAST_PATH := $(PAY_TO_PLAY_BROADCAST_DIR)/DeployPayToPlayLocal.s.sol/31337/run-latest.json
PAY_TO_PLAY_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) PAY_TO_PLAY_BROADCAST_DIR=$(PAY_TO_PLAY_BROADCAST_DIR) PAY_TO_PLAY_BROADCAST_PATH=$(PAY_TO_PLAY_BROADCAST_PATH)
PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_ENV := $(PAY_TO_PLAY_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME) CAM_URI=$(PAY_TO_PLAY_CAM_HTTP_ORIGIN)/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(PAY_TO_PLAY_CAM_HTTP_ORIGIN)
PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV := $(PAY_TO_PLAY_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_PROJECT_NAME) CAM_URI=$(PAY_TO_PLAY_GUI_ORIGIN)/cam/main.json CAM_VIEWER_RESOURCE_ORIGIN=$(PAY_TO_PLAY_GUI_ORIGIN) PAY_TO_PLAY_GUI_PORT=$(PAY_TO_PLAY_GUI_PORT) PAY_TO_PLAY_GUI_BIND_HOST=$(PAY_TO_PLAY_GUI_BIND_HOST) PAY_TO_PLAY_GUI_ORIGIN=$(PAY_TO_PLAY_GUI_ORIGIN)
PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/local/deploy.yml -f $(COMPOSE_DIR)/pay-to-play/local/http.yml -f $(COMPOSE_DIR)/pay-to-play/local/scenario.yml
PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/local/deploy.yml -f $(COMPOSE_DIR)/pay-to-play/local/http.yml -f $(COMPOSE_DIR)/pay-to-play/local/viewer-gui.yml
COMPOSE_PROJECT_NAME_VARS += PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME PAY_TO_PLAY_VIEWER_GUI_COMPOSE_PROJECT_NAME
export PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME PAY_TO_PLAY_VIEWER_GUI_COMPOSE_PROJECT_NAME
export PAY_TO_PLAY_GUI_PORT PAY_TO_PLAY_GUI_BIND_HOST PAY_TO_PLAY_GUI_ORIGIN

PAY_TO_PLAY_GUI_BIND_GUARD := port="$${PAY_TO_PLAY_GUI_PORT:?missing_PAY_TO_PLAY_GUI_PORT}"; host="$${PAY_TO_PLAY_GUI_BIND_HOST:?missing_PAY_TO_PLAY_GUI_BIND_HOST}"; origin="$${PAY_TO_PLAY_GUI_ORIGIN:?missing_PAY_TO_PLAY_GUI_ORIGIN}"; if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'PAY_TO_PLAY_GUI_PORT must be an integer from 1 to 65535.' >&2; exit 2; fi; if [[ "$$host" != "127.0.0.1" && "$$host" != "localhost" ]]; then printf '%s\n' 'PAY_TO_PLAY_GUI_BIND_HOST must be 127.0.0.1 or localhost.' >&2; exit 2; fi; if [[ "$$origin" != "http://$$host:$$port" ]]; then printf '%s\n' 'PAY_TO_PLAY_GUI_ORIGIN must match the loopback HTTP bind host and port.' >&2; exit 2; fi

pay-to-play/local/scenario/run: dapps/deps/verify
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES) \
	  up --build --abort-on-container-exit --exit-code-from pay-to-play-local-scenario pay-to-play-local-scenario

pay-to-play/local/demo/gui/up: dapps/deps/verify
	@$(LANE_GUARD); \
	$(PAY_TO_PLAY_GUI_BIND_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES) \
	    $(COMPOSE_DOWN_CLEANUP); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES) \
	  up --build --detach pay-to-play-anvil pay-to-play-cam-http; \
	$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES) \
	  run --build --rm --no-deps deploy-pay-to-play-local; \
	viewer_url="$$( \
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	    $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES) \
	    run --build --rm --no-deps -T pay-to-play-viewer-url \
	)"; \
	printf '\n%s\n\n' "$$viewer_url"; \
	$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES) \
	  up --build --force-recreate --abort-on-container-exit cam-web pay-to-play-browser-gateway

pay-to-play/local/demo/gui/down:
	@$(LANE_GUARD); \
	$(PAY_TO_PLAY_GUI_BIND_GUARD); \
	$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES) \
	  $(COMPOSE_DOWN_CLEANUP)


.PHONY: pay-to-play/local/scenario/run pay-to-play/local/demo/gui/up pay-to-play/local/demo/gui/down pay-to-play/local/voucher/sign

export FIXTURE_ID
PAY_TO_PLAY_FIXTURE_PROJECT = dapps-pay-to-play-fixture-$(FIXTURE_ID)
PAY_TO_PLAY_FIXTURE_NETWORK = $(PAY_TO_PLAY_FIXTURE_PROJECT)_pay-to-play_local
PAY_TO_PLAY_FIXTURE_COMPOSE_ENV = $(PAY_TO_PLAY_COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(PAY_TO_PLAY_FIXTURE_PROJECT) PAY_TO_PLAY_FIXTURE_PROJECT=$(PAY_TO_PLAY_FIXTURE_PROJECT) CAM_URI=$(PAY_TO_PLAY_CAM_HTTP_ORIGIN)/main.json PAY_TO_PLAY_FIXTURE_NETWORK=$(PAY_TO_PLAY_FIXTURE_NETWORK)
PAY_TO_PLAY_FIXTURE_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/local/deploy.yml -f $(COMPOSE_DIR)/pay-to-play/local/http.yml -f $(COMPOSE_DIR)/pay-to-play/local/fixture.yml
PAY_TO_PLAY_FIXTURE_GUARD := if [[ ! "$${FIXTURE_ID:?Set FIXTURE_ID for this fixture run}" =~ ^[a-z0-9][a-z0-9_-]{0,47}$$ ]]; then printf '%s\n' 'FIXTURE_ID must be 1-48 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.' >&2; exit 2; fi

define pay_to_play_fixture_compose
$(PAY_TO_PLAY_FIXTURE_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(PAY_TO_PLAY_FIXTURE_COMPOSE_FILES) $(1)
endef

.PHONY: pay-to-play/local/fixture/up pay-to-play/local/fixture/info pay-to-play/local/fixture/down
pay-to-play/local/fixture/up:
	@$(LANE_GUARD); $(PAY_TO_PLAY_FIXTURE_GUARD); \
	for resource in container network volume; do \
	  existing="$$(docker "$$resource" ls --quiet --filter 'label=com.docker.compose.project=$(PAY_TO_PLAY_FIXTURE_PROJECT)')"; \
	  if [[ -n "$$existing" ]]; then printf '%s\n' 'Fixture already exists; use another FIXTURE_ID or stop this fixture first.' >&2; exit 2; fi; \
	done; \
	$(MAKE) dapps/deps/verify; \
	docker network create --internal \
	  --label 'com.docker.compose.project=$(PAY_TO_PLAY_FIXTURE_PROJECT)' \
	  --label 'com.docker.compose.network=pay-to-play_local' \
	  '$(PAY_TO_PLAY_FIXTURE_NETWORK)' >/dev/null; \
	cleanup() { \
	  status="$$?"; \
	  if (( status != 0 )); then \
	    $(call pay_to_play_fixture_compose,down --volumes) || printf '%s\n' 'Fixture cleanup failed; retry fixture/down with the same FIXTURE_ID.' >&2; \
	  fi; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(call pay_to_play_fixture_compose,up --build --detach --wait --wait-timeout 60 pay-to-play-anvil pay-to-play-cam-http); \
	$(PAY_TO_PLAY_FIXTURE_COMPOSE_ENV) timeout 180 env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(PAY_TO_PLAY_FIXTURE_COMPOSE_FILES) run --build --rm --no-deps -T deploy-pay-to-play-local; \
	$(call pay_to_play_fixture_compose,run --pull never --rm --no-deps -T pay-to-play-fixture-info) >/dev/null

pay-to-play/local/fixture/info:
	@$(LANE_GUARD); $(PAY_TO_PLAY_FIXTURE_GUARD); \
	for service in pay-to-play-anvil pay-to-play-cam-http; do \
	  running="$$( $(call pay_to_play_fixture_compose,ps --quiet --status running) "$$service" )"; \
	  if [[ -z "$$running" ]]; then printf 'Fixture service %s is not running; start this FIXTURE_ID first.\n' "$$service" >&2; exit 2; fi; \
	done; \
	docker volume inspect '$(PAY_TO_PLAY_FIXTURE_PROJECT)_pay-to-play_broadcast' >/dev/null; \
	$(call pay_to_play_fixture_compose,run --pull never --rm --no-deps -T pay-to-play-fixture-info)

pay-to-play/local/fixture/down:
	@$(LANE_GUARD); $(PAY_TO_PLAY_FIXTURE_GUARD); \
	$(call pay_to_play_fixture_compose,down --volumes)


# Offline fixture signing: only the fixed local customer key is available here.
PAY_TO_PLAY_ADDRESS ?=
PAY_TO_PLAY_CHANNEL_ID ?= 1
PAY_TO_PLAY_TOTAL ?=
PAY_TO_PLAY_INVOICE_HASH ?=
export PAY_TO_PLAY_ADDRESS PAY_TO_PLAY_CHANNEL_ID PAY_TO_PLAY_TOTAL PAY_TO_PLAY_INVOICE_HASH
pay-to-play/local/voucher/sign:
	@$(LANE_GUARD); \
	if [[ ! "$$PAY_TO_PLAY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$$ || ! "$$PAY_TO_PLAY_CHANNEL_ID" =~ ^[0-9]+$$ || ! "$$PAY_TO_PLAY_TOTAL" =~ ^[0-9]+$$ || ! "$$PAY_TO_PLAY_INVOICE_HASH" =~ ^0x[0-9a-fA-F]{64}$$ ]]; then \
	  printf '%s\n' 'Set PAY_TO_PLAY_ADDRESS to the local PayToPlay address and PAY_TO_PLAY_CHANNEL_ID/PAY_TO_PLAY_TOTAL to unsigned decimal integers, and PAY_TO_PLAY_INVOICE_HASH to the signed invoice reference (0x plus 64 hex digits).' >&2; exit 2; \
	fi; \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/cast.yml run --build --rm --no-deps -T \
	  -e PAY_TO_PLAY_ADDRESS -e PAY_TO_PLAY_CHANNEL_ID -e PAY_TO_PLAY_TOTAL -e PAY_TO_PLAY_INVOICE_HASH cast-offline \
	  bash -eu -c 'customer="$$(cast wallet address --private-key 0xcacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacaca)"; \
	  typed="$$(printf '\''{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Voucher":[{"name":"customer","type":"address"},{"name":"channelId","type":"uint256"},{"name":"cumulativeTotal","type":"uint256"},{"name":"invoiceHash","type":"bytes32"}]},"primaryType":"Voucher","domain":{"name":"PayToPlay","version":"2","chainId":31337,"verifyingContract":"%s"},"message":{"customer":"%s","channelId":"%s","cumulativeTotal":"%s","invoiceHash":"%s"}}'\'' "$$PAY_TO_PLAY_ADDRESS" "$$customer" "$$PAY_TO_PLAY_CHANNEL_ID" "$$PAY_TO_PLAY_TOTAL" "$$PAY_TO_PLAY_INVOICE_HASH")"; \
	  cast wallet sign --private-key 0xcacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacaca --data "$$typed"'

.PHONY: pay-to-play/live/browser/check
pay-to-play/live/browser/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	CDP_ORIGIN="$${CDP_ORIGIN:?Set CDP_ORIGIN}" VIEWER_URL="$${VIEWER_URL:?Set VIEWER_URL}" \
	EXPECTED_CAM_URI="$${EXPECTED_CAM_URI:?Set EXPECTED_CAM_URI}" EXPECTED_CAM_HASH="$${EXPECTED_CAM_HASH:?Set EXPECTED_CAM_HASH}" \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/pay-to-play/local/browser-check.yml run --build --rm --no-deps -T pay-to-play-viewer-browser-check

# Distinct foreground grant: a local signer for one already-running browser tab.
.PHONY: viewer/local/fixture-wallet/attach
viewer/local/fixture-wallet/attach:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	FIXTURE_WALLET_APP="$${FIXTURE_WALLET_APP:?Set FIXTURE_WALLET_APP}" CDP_TARGET_ID="$${CDP_TARGET_ID:?Set CDP_TARGET_ID}" \
	CDP_ORIGIN="$${CDP_ORIGIN:?Set CDP_ORIGIN}" VIEWER_URL="$${VIEWER_URL:?Set VIEWER_URL}" \
	EXPECTED_CAM_URI="$${EXPECTED_CAM_URI:?Set EXPECTED_CAM_URI}" EXPECTED_CAM_HASH="$${EXPECTED_CAM_HASH:?Set EXPECTED_CAM_HASH}" \
	EXPECTED_CONTRACT_ADDRESS="$${EXPECTED_CONTRACT_ADDRESS:?Set EXPECTED_CONTRACT_ADDRESS}" \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/browser-fixture-wallet.yml run --build --rm --no-deps -T browser-fixture-wallet
export REFUND_CONFIG_FILE RPC_URL_FILE REFUND_PRIVATE_KEY_FILE REFUND_STATE_DIR
.PHONY: pay-to-play/local/recovery/run pay-to-play/refunds/check pay-to-play/refunds/plan pay-to-play/refunds/run
REFUND_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/refunds/check.yml
REFUND_PLAN_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/refunds/run.yml
REFUND_EXECUTE_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/refunds/run.yml -f $(COMPOSE_DIR)/pay-to-play/refunds/execute.yml

pay-to-play/refunds/check:
	@$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) $(REFUND_CHECK_COMPOSE_FILES) run --build --rm --no-deps -T pay-to-play-refunds-check

define refund_input_guards
$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); \
$(release_host_guard_functions); \
require_protected_release_file "$${REFUND_CONFIG_FILE:?Set REFUND_CONFIG_FILE}" REFUND_CONFIG_FILE REFUND_CONFIG_FILE; \
require_protected_release_file "$${RPC_URL_FILE:?Set RPC_URL_FILE}" RPC_URL_FILE RPC_URL_FILE
endef

pay-to-play/refunds/plan:
	@$(refund_input_guards); \
	$(COMPOSE_ENV) env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(REFUND_PLAN_COMPOSE_FILES) run --build --rm --no-deps -T pay-to-play-refunds

pay-to-play/refunds/run:
	@$(refund_input_guards); \
	if [[ "$${CONFIRM_PAY_TO_PLAY_REFUNDS:?Set CONFIRM_PAY_TO_PLAY_REFUNDS=YES}" != YES ]]; then printf '%s\n' 'Set CONFIRM_PAY_TO_PLAY_REFUNDS=YES after reviewing deployment pins, scope and the gas budget.' >&2; exit 2; fi; \
	require_protected_release_file "$${REFUND_PRIVATE_KEY_FILE:?Set REFUND_PRIVATE_KEY_FILE}" REFUND_PRIVATE_KEY_FILE REFUND_PRIVATE_KEY_FILE; \
	state="$${REFUND_STATE_DIR:?Set REFUND_STATE_DIR}"; \
	if [[ "$$state" != /* || "$$(realpath -m -- "$$state")" != "$$state" ]]; then printf '%s\n' 'REFUND_STATE_DIR must be a normalized absolute path.' >&2; exit 2; fi; \
	reject_release_path_symlinks "$$state" REFUND_STATE_DIR; \
	if [[ ! -d "$$state" || "$$(stat -c %a -- "$$state")" != 700 || "$$(stat -c %u -- "$$state")" != "$(LOCAL_UID)" ]]; then printf '%s\n' 'Pre-create REFUND_STATE_DIR owned by LOCAL_UID with mode 0700.' >&2; exit 2; fi; \
	case "$$state" in "$$(pwd -P)"|"$$(pwd -P)"/*) printf '%s\n' 'REFUND_STATE_DIR must be outside the repository.' >&2; exit 2 ;; esac; \
	$(COMPOSE_ENV) env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(REFUND_EXECUTE_COMPOSE_FILES) run --build --rm --no-deps -T pay-to-play-refunds

# Reuse the maintained fixture lifecycle and its existing account grants. The
# overlay replaces only the scenario command; no live RPC or signing key mounts.
RECOVERY_SCENARIO_COMPOSE_FILES := -f $(COMPOSE_DIR)/pay-to-play/local/deploy.yml -f $(COMPOSE_DIR)/pay-to-play/local/http.yml -f $(COMPOSE_DIR)/pay-to-play/local/scenario.yml -f $(COMPOSE_DIR)/pay-to-play/local/recovery-scenario.yml
pay-to-play/local/recovery/run:
	@$(MAKE) pay-to-play/local/scenario/run PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES="$(RECOVERY_SCENARIO_COMPOSE_FILES)"
