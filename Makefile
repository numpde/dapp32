SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# Freeze literal release inputs before shell probes can export command-line values.
ifneq ($(origin INSTANCE),undefined)
override INSTANCE := $(value INSTANCE)
export INSTANCE
endif
ifneq ($(origin CONFIG),undefined)
override CONFIG := $(value CONFIG)
export CONFIG
endif
ifneq ($(origin UI_CONFIG),undefined)
override UI_CONFIG := $(value UI_CONFIG)
export UI_CONFIG
endif
ifneq ($(origin CAM_CONFIG),undefined)
override CAM_CONFIG := $(value CAM_CONFIG)
export CAM_CONFIG
endif
ifneq ($(origin CONTRACT_ARTIFACT),undefined)
override CONTRACT_ARTIFACT := $(value CONTRACT_ARTIFACT)
export CONTRACT_ARTIFACT
endif
ifneq ($(origin UI_ARTIFACT),undefined)
override UI_ARTIFACT := $(value UI_ARTIFACT)
export UI_ARTIFACT
endif
ifneq ($(origin ROOT),undefined)
override ROOT := $(value ROOT)
export ROOT
endif
ifneq ($(origin ROOT_ARTIFACT),undefined)
override ROOT_ARTIFACT := $(value ROOT_ARTIFACT)
export ROOT_ARTIFACT
endif
ifneq ($(origin CAM_BUNDLE),undefined)
override CAM_BUNDLE := $(value CAM_BUNDLE)
export CAM_BUNDLE
endif
ifneq ($(origin CAM_RECORDS),undefined)
override CAM_RECORDS := $(value CAM_RECORDS)
export CAM_RECORDS
endif
ifneq ($(origin OUTPUT_DIR),undefined)
override OUTPUT_DIR := $(value OUTPUT_DIR)
export OUTPUT_DIR
endif
ifneq ($(origin CONTRACT_RECORDS),undefined)
override CONTRACT_RECORDS := $(value CONTRACT_RECORDS)
export CONTRACT_RECORDS
endif
ifneq ($(origin UI_RECORDS),undefined)
override UI_RECORDS := $(value UI_RECORDS)
export UI_RECORDS
endif


COMPOSE_DIR := compose
DOCKER_COMPOSE ?= docker compose
# Compose stdout is captured by several operator workflows; progress must not
# require a console or interleave terminal control sequences with their output.
export COMPOSE_PROGRESS := plain
export COMPOSE_ANSI := never
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
VIEWER_IMAGE ?= dapp32-viewer:local
VIEWER_BIND_HOST ?= 127.0.0.1
VIEWER_PORT ?= 8080
VIEWER_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-viewer
export VIEWER_IMAGE VIEWER_BIND_HOST VIEWER_PORT VIEWER_COMPOSE_PROJECT_NAME
RELEASE_ARTIFACT_NODE_MODULES_DIR ?= $(CURDIR)/js/node_modules
export RELEASE_ARTIFACT_NODE_MODULES_DIR
ACTUAL_UID := $(shell id -u)
LOCAL_UID ?= $(shell id -u)
LOCAL_GID ?= $(shell id -g)
ALLOW_UPDATE ?= 0

RPC_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-cast-rpc
# Intentional default: isolate the persistent indexing proxy from Cast and
# release services. Set a distinct project per chain when running several.
RPC_INDEXER_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-rpc-indexer
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
COMPOSE_PROJECT_NAME_VARS := COMPOSE_PROJECT_NAME RPC_COMPOSE_PROJECT_NAME RPC_INDEXER_COMPOSE_PROJECT_NAME ANVIL_COMPOSE_PROJECT_NAME LIVE_CHECK_COMPOSE_PROJECT_NAME BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME BIKE_NFT_RELEASE_CHECK_COMPOSE_PROJECT_NAME ESCROW_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME ESCROW_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ESCROW_VIEWER_GUI_COMPOSE_PROJECT_NAME ESCROW_RELEASE_CHECK_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME VIEWER_TERMINAL_COMPOSE_PROJECT_NAME VIEWER_TERMINAL_CONTAINER_NAME
export $(COMPOSE_PROJECT_NAME_VARS)

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)
DEPS_COMPOSE_PROJECT_NAME := $(COMPOSE_PROJECT_NAME)-solidity-deps
PACKAGE_DEPS_COMPOSE_PROJECT_NAME := $(COMPOSE_PROJECT_NAME)-js-deps
ABI_EXPORT_COMPOSE_PROJECT_NAME := $(COMPOSE_PROJECT_NAME)-abi-export
DEPS_COMPOSE_ENV := $(COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(DEPS_COMPOSE_PROJECT_NAME) ALLOW_UPDATE=$(ALLOW_UPDATE)
PACKAGE_DEPS_COMPOSE_ENV := $(COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(PACKAGE_DEPS_COMPOSE_PROJECT_NAME) ALLOW_UPDATE=$(ALLOW_UPDATE)
ABI_EXPORT_COMPOSE_ENV := $(COMPOSE_ENV) COMPOSE_PROJECT_NAME=$(ABI_EXPORT_COMPOSE_PROJECT_NAME)
RPC_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_COMPOSE_PROJECT_NAME)
RPC_INDEXER_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_INDEXER_COMPOSE_PROJECT_NAME)
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
ESCROW_LOCAL_SCENARIO_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/deploy.yml -f $(COMPOSE_DIR)/escrow/local/http.yml -f $(COMPOSE_DIR)/escrow/local/scenario.yml
ESCROW_VIEWER_TERMINAL_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/deploy.yml -f $(COMPOSE_DIR)/escrow/local/http.yml -f $(COMPOSE_DIR)/escrow/local/viewer-terminal.yml
ESCROW_VIEWER_GUI_COMPOSE_FILES := -f $(COMPOSE_DIR)/escrow/local/deploy.yml -f $(COMPOSE_DIR)/escrow/local/http.yml -f $(COMPOSE_DIR)/escrow/local/viewer-gui.yml
ESCROW_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml -f $(COMPOSE_DIR)/escrow/release/check.yml
PAY_TO_PLAY_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml -f $(COMPOSE_DIR)/pay-to-play/release/check.yml
CONTRACT_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml
CONTRACT_RELEASE_ARTIFACT_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/artifact.yml -f $(COMPOSE_DIR)/release/contracts-artifact.yml
CONTRACT_RELEASE_DEPLOY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/deploy.yml $(CONTRACT_RELEASE_ARTIFACT_COMPOSE_FILES) -f $(COMPOSE_DIR)/release/contracts.yml
CAM_RELEASE_ARTIFACT_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/artifact.yml -f $(COMPOSE_DIR)/release/cam-artifact.yml
CAM_RELEASE_DEPLOY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/deploy.yml $(CAM_RELEASE_ARTIFACT_COMPOSE_FILES)
UI_RELEASE_ARTIFACT_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/artifact.yml -f $(COMPOSE_DIR)/release/ui-artifact.yml
UI_RELEASE_DEPLOY_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/deploy.yml $(UI_RELEASE_ARTIFACT_COMPOSE_FILES) -f $(COMPOSE_DIR)/release/ui.yml
UI_RELEASE_CHECK_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/check.yml -f $(COMPOSE_DIR)/release/ui-check.yml
export PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID PAY_TO_PLAY_RELEASE_CAM_URI PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD PAY_TO_PLAY_RELEASE_OUTPUT_DIR PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_FILE CONFIRM_PAY_TO_PLAY_RELEASE_DEPLOY
LOCAL_RELEASE_PROJECT := $(COMPOSE_PROJECT_NAME)-release-local
LOCAL_RELEASE_NETWORK := $(LOCAL_RELEASE_PROJECT)_anvil_internal
# Intentional default: use a separate loopback port for the release attachment.
RELEASE_VIEWER_PORT ?= 5174
RELEASE_VIEWER_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-release-viewer
COMPOSE_PROJECT_NAME_VARS += RELEASE_VIEWER_COMPOSE_PROJECT_NAME
COMPOSE_PROJECT_NAME_VARS += VIEWER_COMPOSE_PROJECT_NAME
export RELEASE_VIEWER_COMPOSE_PROJECT_NAME
export RELEASE_VIEWER_PORT
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
CAM_RESOURCE_OUTPUT_GUARD := if [[ ! -f docs/reference/cam/1.3.0/index.html ]]; then printf '%s\n' 'CAM protocol reference must be an existing regular file: docs/reference/cam/1.3.0/index.html' >&2; exit 2; fi; for cam_path in dapps/bike-nft/cam/{main.json,protocol.html} dapps/escrow/cam/{main.json,protocol.html} dapps/pay-to-play/cam/{main.json,protocol.html}; do if [[ ! -f "$$cam_path" ]]; then printf 'CAM output must be an existing regular file: %s\n' "$$cam_path" >&2; exit 2; fi; done
CAM_URI_GUARD := uri="$${CAM_URI?missing_CAM_URI}"; if [[ -z "$$uri" ]]; then printf '%s\n' 'Set CAM_URI to the CAM document URI for the local fixture.' >&2; exit 2; fi; if [[ ! "$$uri" =~ ^(https?|ipfs):// || "$$uri" == *'$$'* || "$$uri" == *'`'* || "$$uri" == *\"* || "$$uri" == *\'* || "$$uri" == *\;* ]]; then printf '%s\n' 'CAM_URI must be an absolute http(s) or ipfs URI without shell syntax.' >&2; exit 2; fi
CAM_INTEGRATION_INPUT_GUARD := seed="$${CAM_INTEGRATION_SEED:?missing_CAM_INTEGRATION_SEED}"; runs="$${CAM_INTEGRATION_RUNS:?missing_CAM_INTEGRATION_RUNS}"; steps="$${CAM_INTEGRATION_STEPS:?missing_CAM_INTEGRATION_STEPS}"; if [[ ! "$$seed" =~ ^[A-Za-z0-9_.:-]{1,128}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_SEED must be 1-128 URL-safe label characters.' >&2; exit 2; fi; if [[ ! "$$runs" =~ ^[1-9][0-9]{0,3}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_RUNS must be a positive decimal integer under 10000.' >&2; exit 2; fi; if [[ ! "$$steps" =~ ^[1-9][0-9]{0,3}$$ ]]; then printf '%s\n' 'CAM_INTEGRATION_STEPS must be a positive decimal integer under 10000.' >&2; exit 2; fi
VIEWER_TERMINAL_MOCK_GUARD := if [[ ! "$${VIEWER_TERMINAL_MOCK:?missing_VIEWER_TERMINAL_MOCK}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$$ ]]; then printf '%s\n' 'VIEWER_TERMINAL_MOCK must be a mock name, not a path or shell expression.' >&2; exit 2; fi
# Preserve a lane's primary error and retain mounted inputs if teardown fails.
define disposable_cleanup_command
timeout -k 15s 60s bash tools/compose_cleanup.sh "$(1)" -- $(DOCKER_COMPOSE) $(2)
endef

define cleanup_disposable_project
$(call disposable_cleanup_command,$(1),$(2)) || { cleanup_status="$$?"; if [[ "$(3)" != "0" ]]; then exit "$(3)"; fi; exit "$$cleanup_status"; }
endef

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
}; \
source tools/release_process.sh; \
release_process_init; \
source tools/release-config.sh
endef

# These serial config runs are networkless --rm --no-deps one-shots. Only a
# failed or interrupted run leaves resource removal unconfirmed.
# INSTANCE is an operator selection boundary; child phase calls use resolved ports.
define release_instance_entry
if [[ -n "$${INSTANCE-}" ]]; then \
  export RELEASE_LOCAL_NETWORK="$(LOCAL_RELEASE_NETWORK)" MAKE="$(MAKE)"; \
  export -f reject_release_path_symlinks; exec bash tools/release_instance.sh "$(1)" "$(2)"; \
fi
endef

define release_config_compose
compose_release_config() { \
	local config_input="$$CONFIG"; \
	if [[ -v release_config_input ]]; then config_input="$$release_config_input"; fi; \
  if [[ "$$1" == run ]]; then release_config_started=1; fi; \
  if LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$release_config_project" \
    RELEASE_CONFIG_STAGE_DIR="$$release_config_dir" RELEASE_CONFIG_FILE="$$config_input" RELEASE_LOCAL_NETWORK="$(LOCAL_RELEASE_NETWORK)" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/release/config.yml "$$@"; then \
    if [[ "$$1" == run ]]; then release_config_started=0; fi; \
  else \
    return "$$?"; \
  fi; \
}
endef

define release_setup_rpc_compose
compose_release_setup_rpc() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$release_config_project-rpc" \
  RPC_URL_FILE="$$release_config_dir/setup-rpc-url" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) \
    -f $(COMPOSE_DIR)/release/setup-rpc.yml -f "$$release_config_dir/images-setup-rpc.yml" "$$@"; \
}
endef

define release_snapshot_allocate
ceremony_root="$$(mktemp -d "/tmp/cam-release-$${LOCAL_UID:?missing_LOCAL_UID}-XXXXXXXX")"; \
chmod 0700 "$$ceremony_root"; \
ceremony_digest="$$(printf '%s' "$$ceremony_root" | sha256sum)"; \
ceremony_project="cam-release-$${ceremony_digest:0:24}"; \
printf 'Release container project: %s-run\n' "$$ceremony_project"; \
ceremony_source="$$ceremony_root/source"
endef

define release_snapshot_archive
mkdir --mode=0700 -- "$$ceremony_source"; \
GIT_NO_REPLACE_OBJECTS=1 git archive --format=tar --output="$$ceremony_root/source.tar" "$$source_commit"; \
tar --extract --file="$$ceremony_root/source.tar" --directory="$$ceremony_source"; \
rm -f -- "$$ceremony_root/source.tar"
endef

define release_snapshot_populate
$(release_snapshot_archive); \
cp -a -- "$(DEPENDENCIES_DIR)" "$$ceremony_source/$(DEPENDENCIES_DIR)"; \
cp -a -- "$(PACKAGE_NODE_MODULES_DIR)" "$$ceremony_source/$(PACKAGE_NODE_MODULES_DIR)"
endef

define release_snapshot_cleanup
status="$$?"; \
cleanup_failed=0; \
if ! release_process_cleanup_begin; then \
  printf '%s\n' 'Owned release process cleanup failed; retaining mounted inputs.' >&2; \
  cleanup_failed=1; \
fi; \
set +e; \
if declare -F release_cam_sources_cleanup >/dev/null && ! release_cam_sources_cleanup; then cleanup_failed=1; fi; \
if declare -F release_approval_cleanup >/dev/null && ! release_approval_cleanup; then \
  printf '%s\n' 'Approval process or terminal cleanup failed; retaining mounted inputs.' >&2; \
  cleanup_failed=1; \
fi; \
release_command_grace=60; \
if [[ "$$release_run_started" == "1" ]] && ! compose_release down --timeout 10 --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'Release run teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$release_check_started" == "1" ]] && ! compose_release_check down --timeout 10 --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'Release check teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$release_dependencies_started" == "1" ]] && ! compose_release_dependencies down --timeout 10 --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'Release dependency-check teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$release_rpc_started" == "1" ]] && ! compose_release_rpc down --timeout 10 --volumes --remove-orphans >/dev/null; then \
  printf '%s\n' 'RPC resolver teardown failed.' >&2; \
  cleanup_failed=1; \
fi; \
if ! release_config_teardown; then \
  printf '%s\n' 'Release configuration teardown failed; retaining mounted inputs.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ "$$cleanup_failed" == "0" ]] && ! release_config_cleanup; then \
  printf '%s\n' 'Release configuration file cleanup failed; retaining mounted inputs.' >&2; \
  cleanup_failed=1; \
fi; \
if [[ -n "$$ceremony_root" ]]; then \
  case "$$ceremony_root" in "/tmp/cam-release-$$LOCAL_UID-"*) \
      if [[ "$$cleanup_failed" == "0" ]] && ! rm -rf -- "$$ceremony_root"; then cleanup_failed=1; fi ;; \
    *) printf 'Refusing to remove unexpected release ceremony path: %s\n' "$$ceremony_root" >&2; cleanup_failed=1 ;; \
  esac; \
fi; \
if [[ "$$cleanup_failed" != "0" ]]; then \
  if [[ -n "$$ceremony_root" ]]; then printf 'Release cleanup is incomplete; retained path for inspection: %s\n' "$$ceremony_root" >&2; fi; \
  if [[ -v release_config_dir && -n "$$release_config_dir" ]]; then printf 'Release cleanup retained mounted inputs: %s\n' "$$release_config_dir" >&2; fi; \
  status=2; \
fi; \
exit "$$status"
endef

define release_snapshot_dependency_compose
compose_release_dependencies() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-deps" ALLOW_UPDATE=0 \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) -f "$$ceremony_source/compose/deps.yml" -f "$$ceremony_root/images-dependencies.yml" "$$@"; \
}
endef

# Every release phase uses these files from the archived commit, including overlays.
release_snapshot_compose_args = $(foreach file,$(filter-out -f,$(1)),-f "$$ceremony_source/$(file)")

define release_resolve_rpc
if [[ ! -v RPC_URL_FILE || -z "$$RPC_URL_FILE" ]]; then \
  mkdir --mode=0700 -- "$$ceremony_root/rpc"; \
  rpc_key_args=(); \
  rpc_key_input() { if [[ -n "$$rpc_api_key_file" ]]; then head -c 258 -- "$$rpc_api_key_file"; fi; }; \
  if [[ -n "$$rpc_api_key_file" ]]; then rpc_key_args=(--api-key-stdin); fi; \
  release_rpc_started=1; \
  compose_release_rpc run --rm --no-deps -T rpc-resolve "$$RPC_CHAIN" "$$RPC_SERVICE" /out/rpc-url "$$release_rpc_expected_chain" "$${rpc_key_args[@]}" < <(rpc_key_input); \
  RPC_URL_FILE="$$ceremony_root/rpc/rpc-url"; \
fi
endef

define release_rpc_compose
compose_release_rpc() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-rpc" \
    RELEASE_RPC_OUTPUT_DIR="$$ceremony_root/rpc" release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL \
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
release_tool_mode="$$release_operation"; \
release_run_owned "$$release_command_grace" bash "$$ceremony_source/tools/release_tool_images.sh" "$$release_tool_mode" "$(CURDIR)" "$$source_commit" "$$ceremony_root"; \
release_image_args=(-f "$$ceremony_root/images-$$release_phase.yml"); \
release_transport_args=(); \
if [[ -v RELEASE_REHEARSAL && "$$RELEASE_REHEARSAL" == 1 ]]; then \
  require_release_local_network; \
  release_transport_phase="$$release_phase"; \
  if [[ "$$release_phase" == cam-bundle ]]; then release_transport_phase=artifact; fi; \
  release_transport_args=(-f "$$ceremony_source/compose/release/rehearsal-$$release_transport_phase.yml"); \
fi; \
$(release_resolve_rpc); \
release_dependencies_started=1; \
compose_release_dependencies run --rm soldeer-verify
endef

define release_deploy_execution
release_operation="$(4)"; export RELEASE_OPERATION="$$release_operation"; \
release_phase=deploy; \
release_rpc_expected_chain="$$chain_id"; \
$(release_prepare_snapshot); \
if [[ "$$release_operation" == cam && "$$CAM_RELEASE_ROOT" == new ]]; then printf "{}\n" > "$$ceremony_root/new-root.json"; export CAM_RELEASE_ROOT_ARTIFACT_FILE="$$ceremony_root/new-root.json"; fi; \
release_check_started=1; \
compose_release_check run --rm release-check; \
source "$$ceremony_source/tools/release_approval_deploy.sh"; \
if [[ "$$release_operation" != cam ]]; then release_approval_require_terminal; fi; \
release_approval_require_image; \
release_phase_overlays=(-f "$$ceremony_source/compose/release/reference.yml"); \
if [[ "$$release_operation" == cam ]]; then release_phase_overlays+=(-f "$$ceremony_source/compose/release/cam.yml"); fi; \
approval_prefix="$(1)"; approval_prefix="$${approval_prefix%_RELEASE_OUTPUT_DIR}"; \
expected_deployer_name="$${approval_prefix}_RELEASE_EXPECTED_DEPLOYER_ADDRESS"; \
approval_app="$${approval_prefix,,}"; approval_app="$${approval_app//_/-}"; \
if [[ -n "$(2)" ]]; then approval_app="$(2)"; fi; \
if [[ -n "$(3)" ]]; then expected_deployer_name="$(3)"; fi; \
if [[ ! -v $$expected_deployer_name ]]; then printf 'Missing required release input: %s\n' "$$expected_deployer_name" >&2; exit 2; fi; \
expected_deployer="$${!expected_deployer_name}"; \
release_approval_require_deployer "$$expected_deployer_name" "$$expected_deployer"; \
recheck_new_release_output "$$output_dir" "$(1)"; \
mkdir --mode=0700 -- "$$output_dir"; \
mkdir --mode=0700 -- "$$output_dir/plan" "$$output_dir/broadcast" "$$output_dir/artifact"; \
if [[ "$$release_operation" == ui ]]; then export UI_RELEASE_CANDIDATE_DIR="$$output_dir/ui-candidate"; fi; \
if [[ "$$release_operation" == contracts ]]; then export CONTRACT_RELEASE_CANDIDATE_DIR="$$output_dir/contract-candidate"; fi; \
if [[ "$$release_operation" == cam ]]; then export CAM_RELEASE_CANDIDATE_DIR="$$output_dir/cam-candidate"; fi; \
release_run_started=1; \
release_approval_prepare "$$approval_app" "$$expected_deployer" "$$source_commit" "$$chain_id" "$$output_dir"; \
release_approval_run "$$output_dir"; \
if [[ "$$release_operation" == ui ]]; then \
  printf 'Verified UI artifact: %s/artifact/ui-deployment.json\n' "$$output_dir"; \
elif [[ "$$release_operation" == cam ]]; then printf 'Verified CAM artifact: %s/artifact/cam-publication.json\n' "$$output_dir"; \
elif [[ "$$release_operation" == contracts ]]; then printf 'Verified business artifact: %s/artifact/contract-deployment.json\n' "$$output_dir"; \
else printf 'Release artifact: %s/artifact/deployment.json\n' "$$output_dir"; fi
endef

define release_contracts_deploy
$(LANE_GUARD); \
$(SOLDEER_DEPS_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(call release_require_clean_source,independent business deployment); \
$(release_host_guard_functions); \
$(call release_instance_entry,$(patsubst %/release/contracts/deploy,%,$@),contracts/deploy); \
$(release_config_compose); \
if [[ ! -v CONFIG || -z "$$CONFIG" ]]; then printf '%s\n' 'Business deployment requires CONFIG with its chain, creator, RPC, signing key and output directory.' >&2; exit 2; fi; \
load_release_config $(patsubst %/release/contracts/deploy,%,$@) contracts-deploy; \
chain_id="$$CONTRACT_RELEASE_EXPECTED_CHAIN_ID"; \
require_release_rpc_input; \
require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" DEPLOYER_PRIVATE_KEY_FILE "$$DEPLOYER_PRIVATE_KEY_FILE"; \
output_dir="$$CONTRACT_RELEASE_OUTPUT_DIR"; \
validate_new_release_output "$$output_dir" CONTRACT_RELEASE_OUTPUT_DIR; \
compose_release() { $(call release_deploy_compose,$(CONTRACT_RELEASE_DEPLOY_COMPOSE_FILES)); }; \
compose_release_check() { \
  if [[ "$$1" == run ]]; then set -- run -e RELEASE_TOOL_DIR=tools/contract-release "$${@:2}"; fi; \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-check" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(CONTRACT_RELEASE_CHECK_COMPOSE_FILES)) -f "$$ceremony_root/images-check.yml" "$$@"; \
}; \
$(call release_deploy_execution,CONTRACT_RELEASE_OUTPUT_DIR,$(patsubst %/release/contracts/deploy,%,$@),CONTRACT_RELEASE_CREATOR_ADDRESS,contracts)
endef

define release_ui_deploy
$(LANE_GUARD); \
$(SOLDEER_DEPS_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(call release_require_clean_source,independent UI deployment); \
$(release_host_guard_functions); \
$(call release_instance_entry,$(patsubst %/release/ui/deploy,%,$@),ui/deploy); \
$(release_config_compose); \
if [[ ! -v CONFIG || -z "$$CONFIG" ]]; then printf '%s\n' 'UI deployment requires CONFIG with its chain, creator, RPC, signing key and output directory.' >&2; exit 2; fi; \
if [[ ! -v CONTRACT_ARTIFACT || -z "$$CONTRACT_ARTIFACT" ]]; then printf '%s\n' 'Set CONTRACT_ARTIFACT to the backing business deployment artifact.' >&2; exit 2; fi; \
require_release_file "$$CONTRACT_ARTIFACT" CONTRACT_ARTIFACT; \
load_release_config $(patsubst %/release/ui/deploy,%,$@) ui-deploy; \
export UI_RELEASE_CONTRACT_ARTIFACT_FILE="$$CONTRACT_ARTIFACT"; \
chain_id="$$UI_RELEASE_EXPECTED_CHAIN_ID"; \
require_release_rpc_input; \
require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" DEPLOYER_PRIVATE_KEY_FILE "$$DEPLOYER_PRIVATE_KEY_FILE"; \
output_dir="$$UI_RELEASE_OUTPUT_DIR"; \
validate_new_release_output "$$output_dir" UI_RELEASE_OUTPUT_DIR; \
compose_release() { $(call release_deploy_compose,$(UI_RELEASE_DEPLOY_COMPOSE_FILES)); }; \
compose_release_check() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-check" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(UI_RELEASE_CHECK_COMPOSE_FILES)) -f "$$ceremony_root/images-check.yml" "$$@"; \
}; \
$(call release_deploy_execution,UI_RELEASE_OUTPUT_DIR,$(patsubst %/release/ui/deploy,%,$@),UI_RELEASE_CREATOR_ADDRESS,ui)
endef

define release_cam_bundle
$(LANE_GUARD); \
$(SOLDEER_DEPS_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(release_host_guard_functions); \
$(call release_instance_entry,$(patsubst %/release/cam/bundle,%,$@),cam/bundle); \
$(release_config_compose); \
source_commit="$$(git rev-parse HEAD)"; \
if [[ ! -v CONFIG || -z "$$CONFIG" ]]; then printf '%s\n' 'CAM bundle preparation requires read-only CONFIG.' >&2; exit 2; fi; \
load_release_config $(patsubst %/release/cam/bundle,%,$@) cam-bundle; \
require_release_file "$${CONTRACT_ARTIFACT:?Set CONTRACT_ARTIFACT}" CONTRACT_ARTIFACT; \
require_release_file "$${UI_ARTIFACT:?Set UI_ARTIFACT}" UI_ARTIFACT; \
source tools/release_cam.sh; release_cam_select_root; \
export CAM_RELEASE_BUSINESS_ARTIFACT_FILE="$$CONTRACT_ARTIFACT" CAM_RELEASE_UI_ARTIFACT_FILE="$$UI_ARTIFACT"; \
output_dir="$$CAM_RELEASE_OUTPUT_DIR"; validate_new_release_output "$$output_dir" CAM_RELEASE_OUTPUT_DIR; \
require_release_rpc_input; \
release_operation=cam-bundle; release_phase=cam-bundle; release_rpc_expected_chain="$$CAM_RELEASE_EXPECTED_CHAIN_ID"; \
compose_release() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
    RELEASE_SOURCE_DIR="$$ceremony_source" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) \
    -f "$$ceremony_source/compose/release/cam-bundle.yml" "$${release_transport_args[@]}" -f "$$ceremony_root/images-cam-bundle.yml" "$$@"; \
}; \
$(release_prepare_snapshot); \
recheck_new_release_output "$$output_dir" CAM_RELEASE_OUTPUT_DIR; \
mkdir --mode=0700 -- "$$output_dir"; \
mkdir --mode=0700 -- "$$output_dir/inputs" "$$output_dir/sources" "$$output_dir/compiler" "$$output_dir/bundle" "$$output_dir/artifact"; \
mkdir --mode=0700 -- "$$output_dir/compiler/business" "$$output_dir/compiler/ui" "$$output_dir/compiler/root"; \
export CAM_RELEASE_PREPARED_DIR="$$output_dir" RELEASE_SOURCE_DIR="$$ceremony_source"; \
if [[ "$$CAM_RELEASE_ROOT" == new ]]; then printf '{}\n' > "$$ceremony_root/new-root.json"; export CAM_RELEASE_ROOT_ARTIFACT_FILE="$$ceremony_root/new-root.json"; \
else export CAM_RELEASE_ROOT_ARTIFACT_FILE="$$ROOT_ARTIFACT"; fi; \
export RPC_URL_FILE; \
release_repository="$(CURDIR)"; source "$$ceremony_source/tools/release_tool_images.sh"; source "$$ceremony_source/tools/release_cam.sh"; \
release_run_started=1; \
release_cam_prepare_sources; \
compose_release up -d --no-build --no-deps --wait --wait-timeout 30 release-artifact-rpc-proxy; \
compose_release run --rm --no-deps -T release-cam-bundle; \
printf 'Prepared CAM bundle: %s/bundle\nBundle artifact: %s/artifact/cam-bundle.json\nHost or pin the bundle before selecting its publication URI. No transaction was sent.\n' "$$output_dir" "$$output_dir"
endef

define release_cam_publish
$(LANE_GUARD); \
$(SOLDEER_DEPS_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(call release_require_clean_source,CAM publication); \
$(release_host_guard_functions); \
$(call release_instance_entry,$(patsubst %/release/cam/publish,%,$@),cam/publish); \
$(release_config_compose); \
if [[ ! -v CONFIG || -z "$$CONFIG" ]]; then printf '%s\n' 'CAM publication requires CONFIG identifying its chain, current root signer, URI and output.' >&2; exit 2; fi; \
load_release_config $(patsubst %/release/cam/publish,%,$@) cam-publish; \
if [[ ! -v CAM_BUNDLE || -z "$$CAM_BUNDLE" ]]; then printf '%s\n' 'Set CAM_BUNDLE to a prepared CAM bundle record directory.' >&2; exit 2; fi; \
reject_release_path_symlinks "$$CAM_BUNDLE" CAM_BUNDLE; \
require_release_file "$$CAM_BUNDLE/artifact/cam-bundle.json" 'Prepared CAM bundle artifact'; \
export CAM_RELEASE_PREPARED_DIR="$$CAM_BUNDLE"; \
if [[ -n "$${CAM_RECORDS-}" ]]; then \
  release_full_make() { release_run_owned "$$release_make_cleanup_grace" $(MAKE) --no-print-directory "$$@"; }; \
  source tools/release_full.sh; \
  release_full_cam $(patsubst %/release/cam/publish,%,$@) "$$CONFIG" "$$CAM_BUNDLE" "$$CAM_RECORDS" publish; exit $$?; \
fi; \
source tools/release_cam.sh; release_cam_select_root; \
chain_id="$$CAM_RELEASE_EXPECTED_CHAIN_ID"; require_release_rpc_input; \
require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" DEPLOYER_PRIVATE_KEY_FILE "$$DEPLOYER_PRIVATE_KEY_FILE"; \
output_dir="$$CAM_RELEASE_OUTPUT_DIR"; validate_new_release_output "$$output_dir" CAM_RELEASE_OUTPUT_DIR; \
compose_release() { $(call release_deploy_compose,$(CAM_RELEASE_DEPLOY_COMPOSE_FILES)); }; \
compose_release_check() { \
  if [[ "$$1" == run ]]; then set -- run -e RELEASE_TOOL_DIR=tools/cam-release "$${@:2}"; fi; \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-check" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) \
    -f "$$ceremony_source/compose/release/check.yml" -f "$$ceremony_root/images-check.yml" "$$@"; \
}; \
$(call release_deploy_execution,CAM_RELEASE_OUTPUT_DIR,$(patsubst %/release/cam/publish,%,$@),CAM_RELEASE_SIGNER_ADDRESS,cam)
endef

define release_independent_artifact
$(LANE_GUARD); \
$(SOLDEER_DEPS_GUARD); \
$(release_host_guard_functions); \
$(call release_instance_entry,$(patsubst %/release/$(2)/artifact,%,$@),$(2)/artifact); \
if [[ "$(2)" == cam ]]; then \
  require_release_file "$${CAM_BUNDLE:?Set CAM_BUNDLE}/artifact/cam-bundle.json" 'Prepared CAM bundle artifact'; \
  export CAM_RELEASE_PREPARED_DIR="$$CAM_BUNDLE"; \
fi; \
tool_source_commit="$$(git rev-parse HEAD)"; source_commit="$$tool_source_commit"; \
$(release_config_compose); \
if [[ ! -v CONFIG || -z "$$CONFIG" ]]; then printf '%s\n' '$(3) artifact completion requires CONFIG for read-only RPC access; no signing key is used.' >&2; exit 2; fi; \
if [[ ! -v $(1) || -z "$$$(1)" ]]; then printf '%s\n' 'Set $(1) to the retained $(3) deployment directory.' >&2; exit 2; fi; \
output_dir="$$$(1)"; \
if [[ "$$output_dir" != /* || "$$(realpath -ms -- "$$output_dir")" != "$$output_dir" ]]; then printf '%s\n' '$(1) must be a normalized absolute directory path.' >&2; exit 2; fi; \
reject_release_path_symlinks "$$output_dir" $(1); \
case "$$output_dir" in "$(CURDIR)"|"$(CURDIR)"/*) printf '%s\n' '$(1) must be outside the checkout.' >&2; exit 2 ;; esac; \
for path in "$$output_dir" "$$output_dir/plan" "$$output_dir/broadcast" "$$output_dir/artifact"; do \
  reject_release_path_symlinks "$$path" '$(3) deployment records'; \
  if [[ ! -d "$$path" ]]; then printf 'Missing $(3) deployment records directory: %s\n' "$$path" >&2; exit 2; fi; \
done; \
load_release_config $(patsubst %/release/$(2)/artifact,%,$@) $(2)-artifact; \
release_config_input="$$output_dir/plan/release-plan.json"; \
require_release_file "$$release_config_input" 'Saved $(3) plan'; \
compose_release_config run --rm --no-deps -T release-config $(2)-plan-source $(patsubst %/release/$(2)/artifact,%,$@) "$$tool_source_commit"; \
unset release_config_input; \
source_commit="$$(< "$$release_config_dir/$(4)-source")"; \
artifact_node_modules="$$RELEASE_ARTIFACT_NODE_MODULES_DIR"; \
if [[ "$$artifact_node_modules" != /* || "$$(realpath -ms -- "$$artifact_node_modules")" != "$$artifact_node_modules" ]]; then printf '%s\n' 'RELEASE_ARTIFACT_NODE_MODULES_DIR must be a normalized absolute directory path.' >&2; exit 2; fi; \
reject_release_path_symlinks "$$artifact_node_modules" RELEASE_ARTIFACT_NODE_MODULES_DIR; \
if [[ ! -d "$$artifact_node_modules" ]]; then printf '%s\n' 'RELEASE_ARTIFACT_NODE_MODULES_DIR must be an installed dependency directory matching the saved $(3) source.' >&2; exit 2; fi; \
$(release_snapshot_dependency_compose); \
ceremony_root=""; release_rpc_started=0; release_dependencies_started=0; release_check_started=0; release_run_started=0; \
cleanup() { $(release_snapshot_cleanup); }; trap cleanup EXIT; \
$(release_snapshot_allocate); \
$(release_snapshot_archive); \
cp -a -- "$(DEPENDENCIES_DIR)" "$$ceremony_source/$(DEPENDENCIES_DIR)"; \
cp -a -- "$$artifact_node_modules" "$$ceremony_source/js/node_modules"; \
release_run_owned 15 bash tools/release_tool_images.sh $(2)-artifact "$(CURDIR)" "$$source_commit" "$$tool_source_commit" "$$ceremony_root"; \
release_dependencies_started=1; \
compose_release_dependencies run --rm soldeer-verify; \
release_transport_args=(); \
if [[ "$$RELEASE_REHEARSAL" == 1 ]]; then require_release_local_network; release_transport_args=(-f "$(COMPOSE_DIR)/release/rehearsal-artifact.yml"); fi; \
compose_release() { \
  LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
    RELEASE_OUTPUT_DIR="$$output_dir" RELEASE_SOURCE_DIR="$$ceremony_source" RPC_URL_FILE="$$RPC_URL_FILE" \
    release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(5) "$${release_transport_args[@]}" -f "$$ceremony_root/images-artifact.yml" "$$@"; \
}; \
source "$$ceremony_source/tools/release_approval_deploy.sh"; \
release_run_started=1; \
release_materialize_$(2) "$$output_dir"
endef

define release_contracts_artifact
$(call release_independent_artifact,CONTRACT_RECORDS,contracts,Business,contract,$(CONTRACT_RELEASE_ARTIFACT_COMPOSE_FILES))
endef

define release_ui_artifact
$(call release_independent_artifact,UI_RECORDS,ui,UI,ui,$(UI_RELEASE_ARTIFACT_COMPOSE_FILES))
endef

# Full release and UI update compose the same ordinary phase entrypoints.
define release_full
$(LANE_GUARD); \
$(SOLDEER_DEPS_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(call release_require_clean_source,release composition); \
$(release_host_guard_functions); \
$(call release_instance_entry,$(1),$(patsubst $(1)/release/%,%,$@)); \
$(release_config_compose); \
if [[ ! -v CONFIG || -z "$$CONFIG" ]]; then printf '%s\n' 'Release composition requires CONFIG.' >&2; exit 2; fi; \
load_release_config $(1) cam-bundle; \
release_full_output="$$CAM_RELEASE_OUTPUT_DIR"; \
release_full_make() { release_run_owned "$$release_make_cleanup_grace" $(MAKE) --no-print-directory "$$@"; }; \
source tools/release_full.sh; \
release_full $(1) $(2) "$$release_full_output"
endef

# App environment assignments remain explicit at the caller.
define release_deploy_compose
LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$$ceremony_project-run" \
  RELEASE_OUTPUT_DIR="$$output_dir" RELEASE_SOURCE_DIR="$$ceremony_source" \
  RPC_URL_FILE="$$RPC_URL_FILE" DEPLOYER_PRIVATE_KEY_FILE="$$DEPLOYER_PRIVATE_KEY_FILE" \
  release_run_owned "$$release_command_grace" env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) $(call release_snapshot_compose_args,$(1)) "$${release_phase_overlays[@]}" "$${release_transport_args[@]}" "$${release_image_args[@]}" "$$@"
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

.PHONY: wallet/addresses/with-keys wallet/addresses wallet/addresses/check release/rpc/list help dapps/deps/install dapps/deps/verify js/deps/install js/deps/graph/check js/build/check js/tests js/ci cam/conformance/check cam/publication/preflight/check viewer/terminal/check cam/integration/fuzz/check bike-nft/release/check bike-nft/release/deploy bike-nft/release/verify escrow/release/check escrow/release/deploy escrow/release/verify tests/checks tests/live tests/live/dependency-egress viewer/terminal/mock/up viewer/terminal/mock/status viewer/terminal/mock/attach viewer/terminal/mock/down tests/checks/anvil-compose dapps/format/check dapps/build dapps/scripts/build cam/abi/export cam/integrity/refresh dapps/tests/unit-scenario dapps/tests/fuzz dapps/tests/invariant cam/live/integration/fuzz/run bike-nft/local/integration/fuzz/run bike-nft/local/integration/fuzz/fixture-writes/run bike-nft/local/integration/fuzz/down dapps/tests/coverage ci cast/offline/check cast/live/block-number/read anvil/internal/up anvil/host/up anvil/down bike-nft/local/deploy bike-nft/local/demo/terminal/up bike-nft/local/demo/terminal/down bike-nft/local/demo/gui/up bike-nft/local/demo/gui/down escrow/local/scenario/run escrow/local/demo/terminal/up escrow/local/demo/terminal/down escrow/local/demo/gui/up escrow/local/demo/gui/down escrow/live/browser/check dapps/tests tests
.PHONY: rpc/indexer/up rpc/indexer/logs rpc/indexer/down

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
	  '  make wallet/addresses/with-keys  Print those 10 accounts with their private keys in the terminal.' \
	  '    Uses the same local offline container; keys are not saved to host files.' \
	  '  make wallet/addresses/check     Test derivation and terminal handling with a public fixture phrase.' \
	  '  make cast/offline/check         Check Foundry cast commands without contacting a blockchain.' \
	  '' \
	  'Compile or update repository files:' \
	  '  make js/build/check             Compile JS workspace packages/apps; keep outputs inside the container.' \
	  '  make js/compiler/qualify        Build packages and fully typecheck the web app/tests in a fresh workspace.' \
	  '    Reports compiler version, workload time, outcome and whole-container cgroup v2 peak memory.' \
	  '    Peak includes setup and tmpfs. Compare the same target in baseline/candidate checkouts.' \
	  '  make dapps/build                Compile Solidity contracts; keep outputs inside the container.' \
	  '  make dapps/scripts/build        Compile deployment scripts without deploying contracts.' \
	  '  make dapps/format/check          Check Solidity formatting without changing files.' \
	  '  make bike-nft/format              Rewrite Solidity formatting in Bike NFT.' \
	  '  make escrow/format                Rewrite Solidity formatting in Escrow.' \
	  '  make pay-to-play/format           Rewrite Solidity formatting in Pay-to-Play.' \
	  '  make deposit/format               Rewrite Solidity formatting in the deposit prototype.' \
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
	  '  make bike-nft/local/deploy CAM_URI=URI  Test a Bike NFT deployment, then remove it; URI must end in /main.json.' \
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
	  '    For attach, set FIXTURE_WALLET_APP=escrow, pay-to-play or bike-nft and CDP_TARGET_ID to that existing tab ID.' \
	  '    EXPECTED_CONTRACT_ADDRESSES is a JSON object mapping every granted namespace to its address. Keep attach running.' \
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
	  'Run the static viewer from this host checkout (no release or publishing):' \
	  '  make viewer/image/build         Build dapp32-viewer:local offline from the current checkout.' \
	  '    Requires installed locked dependencies (make js/deps/install) and locally available pinned base images.' \
	  '  make viewer/up                  Start the built image at http://127.0.0.1:8080; no build or pull.' \
	  '  make viewer/status              Show this viewer container and its health.' \
	  '  make viewer/down                Stop this viewer; does not touch chains or development viewers.' \
	  '    VIEWER_IMAGE selects the local image; VIEWER_PORT selects a host port from 1024 to 65535.' \
	  '    VIEWER_BIND_HOST defaults to 127.0.0.1; set an assigned private interface IP for a containerized HTTPS proxy.' \
	  '    Select the same Docker context for build and start. Rootless resource limits need cgroup v2/systemd delegation.' \
	  '    Forward an existing HTTPS proxy to the selected listener. The browser needs a chain/host/account/RPC link.' \
	  '' \
	  'Prepare CAM publication (validate local files; no upload or contract deployment):' \
	  '  make bike-nft/cam/publication/preflight CAM_URI=URI      Print CAM_HASH for the local Bike NFT bundle.' \
	  '  make escrow/cam/publication/preflight CAM_URI=URI        Print CAM_HASH for the local Escrow bundle.' \
	  '  make pay-to-play/cam/publication/preflight CAM_URI=URI   Print CAM_HASH for the local Pay-to-Play bundle.' \
	  '  make bike-nft/cam/publication/preflight/json CAM_URI=URI      Print Bike NFT validation as JSON.' \
	  '  make escrow/cam/publication/preflight/json CAM_URI=URI        Print Escrow validation as JSON.' \
	  '  make pay-to-play/cam/publication/preflight/json CAM_URI=URI   Print Pay-to-Play validation as JSON.' \
	  '    URI is the intended absolute HTTPS/IPFS manifest address.' \
	  '    Validation reads the local bundle, not a downloaded copy. Publish those exact bytes separately.' \
	  '' \
	  'Deploy or verify a release on an operator-selected blockchain:' \
	  '  make network/local/up            Start a shared local release chain and CAM server in the background.' \
	  '  make network/local/info          Show that running network and its internal connection details.' \
	  '  make network/local/status        Show running or stopped local services and their container health.' \
	  '  make network/local/down          Stop that network and discard its chain state.' \
	  '    Starts infrastructure only. App deployment and verification are separate commands.' \
	  '    No host ports or public network access. Chain 31338 uses public Anvil test accounts.' \
	  '    RPC and CAM URLs work only inside the Docker network. CAM uses HTTP, not HTTPS;' \
	  '    the host browser cannot open http://release-cam:8080. This flow supports deployment and verification.' \
	  '  make network/local/viewer/up     Attach the browser viewer to an existing local release.' \
	  '    Set APP, DEPLOYMENT_ARTIFACT_FILE and RESOURCE_ORIGIN (initial download URL prefix).' \
	  '    Open the printed URL in your browser. Loopback port defaults to 5174; set RELEASE_VIEWER_PORT to override.' \
	  '    The fixture RPC endpoint permits local test transactions. No signing key is mounted.' \
	  '  make network/local/viewer/down   Stop only that viewer; leave the chain running.' \
	  '  make viewer/release/up INSTANCE=/absolute/instance  Open a selected publication; deploys no contracts.' \
	  '    App and default download prefix come from the artifact; IPFS defaults to IPFS only.' \
	  '    Choose the saved publication and a browser-public RPC; the private signing RPC is not exposed.' \
	  '    RESOURCE_ORIGIN: artifact origin by default, * for HTTPS or IPFS, none for IPFS only, or a URL prefix.' \
	  '    Download scope choices apply immediately; custom prefixes apply after typing pauses. URL parameters cannot set it. Quote RESOURCE_ORIGIN="*".' \
	  '    Browser CORS and mixed-content restrictions still apply.' \
	  '    PUBLIC_RPC_URL is visible in the browser link: use a public endpoint without credentials.' \
	  '    No signing key is staged for the viewer. RPC connectivity is checked when the browser loads.' \
	  '    Defaults to http://127.0.0.1:5174. Connect your own wallet for transactions.' \
	  '    Use RELEASE_VIEWER_COMPOSE_PROJECT_NAME and RELEASE_VIEWER_PORT for another viewer instance.' \
	  '  make viewer/release/down INSTANCE=/absolute/instance  Stop only this instance viewer.' \
	  '  make release/rpc/list             List selectable network names, chain IDs and RPC URL templates.' \
	  '  make rpc/indexer/up              Start a read-only RPC proxy for contract log indexing.' \
	  '    Requires RPC_URL_FILE: an absolute, owner-only file outside the checkout, owned by LOCAL_UID.' \
	  '    Set RPC_INDEXER_COMPOSE_PROJECT_NAME per chain; the default is dapps-rpc-indexer.' \
	  '    Clients join that projects rpc_internal network; no host port or signing key is exposed.' \
	  '    Starts only the proxy, not an indexer or database. See https://numpde.github.io/dapp32/deployment/rpc/#indexing for client wiring.' \
	  '  make rpc/indexer/logs            Show the last 100 proxy log lines for that project.' \
	  '  make rpc/indexer/down            Stop that proxy; detach its client containers first.' \
	  '  make dapps/release/rehearsal/check      Rehearse releases for all three supported apps.' \
	  '  make bike-nft/release/rehearsal/run     Rehearse the Bike NFT release on an isolated local chain.' \
	  '  make escrow/release/rehearsal/run       Rehearse the Escrow release on an isolated local chain.' \
	  '  make escrow/release/approval-wait/check Measure pinned Forge approval/receipt waits on a disposable chain.' \
	  '    Runs 10/50/120-second pre-send delays, receipt delay, rejection and lost-response controls.' \
	  '    Reports compatibility failures separately from fixture failures; does not deploy an approval proxy.' \
	  '  make escrow/release/approval/start/check Exercise the live Escrow approval launcher in a PTY.' \
	  '  make bike-nft/release/approval/start/check Exercise Bike NFT approval startup and rejection.' \
	  '  make pay-to-play/release/approval/start/check Exercise Pay-to-Play approval startup and rejection.' \
	  '    Uses the private disposable chain, opens the socket only after start, then rejects the first transaction.' \
	  '  make escrow/release/approval/success/check Approve the disposable Escrow deployment; check receipts, handoffs and CAM.' \
	  '  make bike-nft/release/approval/success/check Approve Bike NFT deployment; check receipts, delayed handoffs and CAM.' \
	  '  make pay-to-play/release/approval/success/check Approve Pay-to-Play deployment; check receipts, handoffs and CAM.' \
	  '    All approval checks use the following inputs and retain their diagnostics after cleanup:' \
	  '    Set RELEASE_APPROVAL_IMAGE_OUTPUT_DIR to the existing image-build folder.' \
	  '    Logs and diagnostics stay in its rehearsals/<UTC-datetime>-<checkout-hash>/ subfolder; the command prints the exact path.' \
	  '    Ten-minute overall deadline; allows up to seven additional minutes for nested cleanup.' \
	  '    Requires host Python 3 and RELEASE_APPROVAL_IMAGE set to the operator-reviewed local sha256 image ID.' \
	  '  make escrow/release/ipc-approval-wait/check Qualify stock Forge over a private Unix socket.' \
	  '    Runs an ordinary release first, then a 120-second hold and failure/receipt controls.' \
	  '  make pay-to-play/release/rehearsal/run  Rehearse the Pay-to-Play release on an isolated local chain.' \
	  '    Requires installed locked dependencies.' \
	  '    Builds its own approval image from the private candidate commit using the locked network dependency stage.' \
	  '    It tests current source, including uncommitted changes, through a private committed snapshot.' \
	  '    It deploys through the normal commands, checks recorded pending handoffs, accepts them,' \
	  '    loads CAM from its recorded URI, and verifies again. Bike admin waits use the local chain clock.' \
	  '    Deployment uses public test keys, private HTTP transport, no host ports and no public network.' \
	  '    Temporary services are removed; records remain at the printed path. Set RELEASE_APPROVAL_IMAGE_OUTPUT_DIR' \
	  '    to keep them under an existing folder; otherwise ordinary rehearsals use /tmp/cam-release-rehearsal-*.' \
	  '  make bike-nft/release/setup INSTANCE=/absolute/instance' \
	  '  make escrow/release/setup INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/setup INSTANCE=/absolute/instance' \
	  '    Choose a configuration role; collect only its settings. Creates INSTANCE when needed.' \
	  '  make bike-nft/release/deploy INSTANCE=/absolute/instance' \
	  '  make escrow/release/deploy INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/deploy INSTANCE=/absolute/instance' \
	  '    Deploy business and UI contracts, prepare CAM files, then configure a new CAM root on chain.' \
	  '  make bike-nft/release/ui/update INSTANCE=/absolute/instance' \
	  '  make escrow/release/ui/update INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/ui/update INSTANCE=/absolute/instance' \
	  '    Deploy a new UI contract or select a saved one, then make the app use it through its existing CAM root.' \
	  '    Matching CAM files are prepared locally; upload or pin them yourself before approving root changes.' \
	  '  make bike-nft/release/verify INSTANCE=/absolute/instance' \
	  '  make escrow/release/verify INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/verify INSTANCE=/absolute/instance' \
	  '    Select saved work and verify or complete records without sending transactions.' \
	  '  make bike-nft/release/contracts/deploy INSTANCE=/absolute/instance' \
	  '  make escrow/release/contracts/deploy INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/contracts/deploy INSTANCE=/absolute/instance' \
	  '    Deploy business contracts independently; the result is an available candidate, not a CAM binding.' \
	  '  make bike-nft/release/ui/deploy INSTANCE=/absolute/instance' \
	  '  make escrow/release/ui/deploy INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/ui/deploy INSTANCE=/absolute/instance' \
	  '    Create and verify a read-only UI contract, leaving the existing CAM root unchanged.' \
	  '  make bike-nft/release/cam/bundle INSTANCE=/absolute/instance' \
	  '  make escrow/release/cam/bundle INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/cam/bundle INSTANCE=/absolute/instance' \
	  '    Prepare matching CAM files locally. Hosting is a separate step; no transaction is sent.' \
	  '  make bike-nft/release/cam/publish INSTANCE=/absolute/instance' \
	  '  make escrow/release/cam/publish INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/cam/publish INSTANCE=/absolute/instance' \
	  '    Create or update the CAM root'\''s contract addresses and manifest URI/hash. Approve each required transaction.' \
	  '  make bike-nft/release/contracts/artifact INSTANCE=/absolute/instance' \
	  '  make escrow/release/contracts/artifact INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/contracts/artifact INSTANCE=/absolute/instance' \
	  '    Complete or verify retained business records without signing.' \
	  '  make bike-nft/release/ui/artifact INSTANCE=/absolute/instance' \
	  '  make escrow/release/ui/artifact INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/ui/artifact INSTANCE=/absolute/instance' \
	  '    Complete or verify retained UI records without signing.' \
	  '  make bike-nft/release/cam/artifact INSTANCE=/absolute/instance' \
	  '  make escrow/release/cam/artifact INSTANCE=/absolute/instance' \
	  '  make pay-to-play/release/cam/artifact INSTANCE=/absolute/instance' \
	  '    Complete or verify retained CAM records without signing.' \
	  '    INSTANCE is an owned private directory outside the checkout (mode 0700).' \
	  '    Commands allocate their records under deployments/ or updates/; no empty output directory is requested.' \
	  '    instance.json stores configuration/record references and unfinished work; artifacts remain authoritative.' \
	  '    Histories are offered as choices, never selected by newest timestamp. Resume uses its original saved inputs.' \
	  '    Separate business, UI and CAM configurations can select different actors; each transaction still needs approval.' \
	  '    Keep all records after failure; rerun the same INSTANCE command to reconcile and resume.' \
	  '    Full deployment and UI update pause for hosting when CAM_URI is unset. Set it after hosting, then resume.' \
	  '  make release/cam/check           Typecheck and test CAM component admission and publication tools.' \
	  '  make release/contracts/check     Typecheck and test shared business deployment plans and approval recipes.' \
	  '  make release/ui/check            Typecheck and test the shared UI deployment tools.' \
	  '  make release/approval/image/build  (HEAD; dated records under ~/Documents; replaces old approval images)' \
	  '    Build the approval tool image from that committed source and fresh locked dependencies.' \
	  '    Two-minute deadline; allows up to 90 additional seconds for cleanup before forced termination.' \
	  '    Writes build records automatically; no approval file or image ID input is needed.' \
	  '    Only after success, verbosely removes old approval-tool images without force; in-use images may prevent cleanup.' \
	  '    SOURCE_COMMIT and RELEASE_APPROVAL_IMAGE_OUTPUT_DIR are optional overrides.' \
	  '    Deployment checks that exact image ID is present locally; it does not establish image provenance.' \
	  '    Each signed transaction is shown for approval; output retains the private audit and transaction records.' \
	  '    A read-only CONFIG can verify retained records; it needs no signing key or approval image.' \
	  '    Signed operations require a clean checkout, installed dependencies and funded signers.' \
	  '    Retained phases are verified/completed keylessly when resumed; they are never redeployed.' \
	  '    Each nominated CAM owner or payment admin accepts ownership separately. Bike admins accept after their delays.' \
	  '    Records retain authorities observed at their verification block; later acceptances do not rewrite those records.' \
	  '    Verifies the saved component and CAM records using their original sources, not current-role/pause expectations.' \
	  '    Retain the complete records after partial failure. For historical monolithic records, use their original checkout.' \
	  '    Workflow, authority handoffs and record layout: https://numpde.github.io/dapp32/deployment/.' \
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
	  $(DEPS_COMPOSE_ENV) $(call cleanup_disposable_project,$(DEPS_COMPOSE_PROJECT_NAME),-f $(COMPOSE_DIR)/deps.yml,$$status); \
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
	$(DEPS_COMPOSE_ENV) $(call cleanup_disposable_project,$(DEPS_COMPOSE_PROJECT_NAME),-f $(COMPOSE_DIR)/deps.yml,0); \
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
	package_user="$$LOCAL_UID:$$LOCAL_GID"; \
	security_options="$$(docker info --format '{{range .SecurityOptions}}{{println .}}{{end}}')"; \
	if grep -Fxq 'name=rootless' <<< "$$security_options"; then package_user=0:0; fi; \
	package_input_dir=""; \
	created_package_lock_placeholder="0"; \
	cleanup() { \
	  status="$$?"; \
	  if [[ -n "$$package_input_dir" ]]; then \
	    $(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(call cleanup_disposable_project,$(PACKAGE_DEPS_COMPOSE_PROJECT_NAME),-f $(COMPOSE_DIR)/package-deps.yml,$$status); \
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
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(call cleanup_disposable_project,$(PACKAGE_DEPS_COMPOSE_PROJECT_NAME),-f $(COMPOSE_DIR)/package-deps.yml,0); \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml run --build --rm --user "$$package_user" package-stage; \
	reject_unsafe_package_targets; \
	mkdir -p "$(PACKAGE_NODE_MODULES_DIR)"; \
	test -d "$(PACKAGE_NODE_MODULES_DIR)"; \
	if [[ "$$ALLOW_UPDATE" = "1" && ! -e "$(PACKAGE_LOCK_FILE)" ]]; then \
	  touch "$(PACKAGE_LOCK_FILE)"; \
	  created_package_lock_placeholder=1; \
	fi; \
	test -f "$(PACKAGE_LOCK_FILE)"; \
	reject_unsafe_package_targets; \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml run --build --rm --user "$$package_user" "$$apply_service"

js/deps/graph/check:
	$(call compose_run_with_package_deps,packages.yml,package-graph-check)

js/build/check:
	$(call compose_run_with_package_deps,packages.yml,package-build-check)

.PHONY: js/compiler/qualify
js/compiler/qualify:
	$(call compose_run_with_package_deps,packages.yml,package-test run-js-workspace node tools/compiler-qualification.mjs)

js/tests:
	$(call compose_run_with_package_deps,packages.yml,package-test)

js/ci: js/tests viewer/terminal/check cam/publication/preflight/check cam/integration/fuzz/check bike-nft/release/check escrow/release/check pay-to-play/release/check release/ui/check release/contracts/check release/cam/check pay-to-play/refunds/check

cam/conformance/check:
	$(call compose_run_with_package_deps,packages.yml,cam-conformance-check)

define cam_publication_preflight
	@$(LANE_GUARD); \
	DAPP="$(firstword $(subst /, ,$@))"; \
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

.PHONY: bike-nft/cam/publication/preflight escrow/cam/publication/preflight pay-to-play/cam/publication/preflight bike-nft/cam/publication/preflight/json escrow/cam/publication/preflight/json pay-to-play/cam/publication/preflight/json
bike-nft/cam/publication/preflight:
	$(call cam_publication_preflight,)

escrow/cam/publication/preflight:
	$(call cam_publication_preflight,)

pay-to-play/cam/publication/preflight:
	$(call cam_publication_preflight,)

bike-nft/cam/publication/preflight/json:
	$(call cam_publication_preflight,--json)

escrow/cam/publication/preflight/json:
	$(call cam_publication_preflight,--json)

pay-to-play/cam/publication/preflight/json:
	$(call cam_publication_preflight,--json)

cam/publication/preflight/check:
	@$(MAKE) --no-print-directory bike-nft/cam/publication/preflight/json CAM_URI=https://example.test/bike-nft/cam/main.json >/dev/null

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

.PHONY: release/approval/image/build
release/approval/image/build:
	@$(LANE_GUARD); \
	source tools/release_approval_images.sh; \
	if [[ "$${SOURCE_COMMIT+x}" == x ]]; then source_commit="$$SOURCE_COMMIT"; else source_commit="$$(git rev-parse HEAD)"; fi; \
	if [[ ! "$$source_commit" =~ ^[0-9a-f]{40}$$ ]]; then printf '%s\n' 'SOURCE_COMMIT must be a full Git commit hash.' >&2; exit 2; fi; \
	if [[ "$${RELEASE_APPROVAL_IMAGE_OUTPUT_DIR+x}" == x ]]; then output_dir="$$RELEASE_APPROVAL_IMAGE_OUTPUT_DIR"; else output_dir="$$(release_approval_default_output "$$source_commit")"; fi; \
	old_images="$$(release_approval_installed_images)"; \
	printf 'Building approval tools from %s; build records: %s\n' "$$source_commit" "$$output_dir"; \
	new_image="$$(release_approval_build_image "$$source_commit" "$$output_dir")"; \
	if [[ ! "$$new_image" =~ ^sha256:[0-9a-f]{64}$$ ]]; then printf '%s\n' 'Approval-image build returned an invalid image identity; old images were not removed.' >&2; exit 2; fi; \
	printf '%s\n' 'Retiring previous approval-tool images. Configurations pinned to removed images need setup again or image restoration.'; \
	release_approval_retire_images "$$new_image" "$$old_images"

bike-nft/release/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(BIKE_NFT_RELEASE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(BIKE_NFT_RELEASE_CHECK_COMPOSE_FILES) run --build --rm -T release-check

.PHONY: release/cam/check
release/cam/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$(COMPOSE_PROJECT_NAME)-cam-release-check" \
	  $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/release/check.yml run --build --rm -T -e RELEASE_TOOL_DIR=tools/cam-release release-check

.PHONY: release/contracts/check
release/contracts/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$(COMPOSE_PROJECT_NAME)-contract-release-check" \
	  $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/release/check.yml run --build --rm -T -e RELEASE_TOOL_DIR=tools/contract-release release-check

.PHONY: release/ui/check
release/ui/check:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$(COMPOSE_PROJECT_NAME)-ui-release-check" \
	  $(DOCKER_COMPOSE) $(UI_RELEASE_CHECK_COMPOSE_FILES) run --build --rm -T release-check

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
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(call cleanup_disposable_project,$(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME),-f $(COMPOSE_DIR)/viewer-terminal.yml,0)

tests/checks:
	$(call compose_run,checks.yml,checks)

tests/live: tests/live/dependency-egress

tests/live/dependency-egress:
	@$(LANE_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(LIVE_CHECK_COMPOSE_ENV) $(call cleanup_disposable_project,$(LIVE_CHECK_COMPOSE_PROJECT_NAME),$(LIVE_DEPS_EGRESS_COMPOSE_FILES),$$status); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from egress-proxy-check egress-proxy-check

tests/checks/anvil-compose:
	@$(LANE_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/checks.yml run --build --rm checks -I -B -m unittest discover -s tests/checks -t . -p test_anvil_compose.py

define dapp_format
	@$(LANE_GUARD); \
	DAPP="$(firstword $(subst /, ,$@))"; \
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
endef

.PHONY: bike-nft/format escrow/format pay-to-play/format deposit/format
bike-nft/format:
	$(dapp_format)

escrow/format:
	$(dapp_format)

pay-to-play/format:
	$(dapp_format)

deposit/format:
	$(dapp_format)

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
	  $(ABI_EXPORT_COMPOSE_ENV) ABI_PLAN_DIR="$$abi_plan_dir" $(call cleanup_disposable_project,$(ABI_EXPORT_COMPOSE_PROJECT_NAME),$(FORGE_ABI_COMPOSE_FILES),$$status); \
	  rm -rf "$$abi_plan_dir"; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(ABI_EXPORT_COMPOSE_ENV) ABI_PLAN_DIR="$$abi_plan_dir" $(DOCKER_COMPOSE) $(FORGE_ABI_COMPOSE_FILES) run --build --rm forge-abi-plan; \
	$(ABI_EXPORT_COMPOSE_ENV) ABI_PLAN_DIR="$$abi_plan_dir" $(DOCKER_COMPOSE) $(FORGE_ABI_COMPOSE_FILES) run --build --rm forge-abi; \
	$(ABI_EXPORT_COMPOSE_ENV) $(DOCKER_COMPOSE) $(CAM_COMPOSE_FILES) run --build --rm cam-integrity

.PHONY: viewer/image/build viewer/up viewer/down viewer/status
viewer/image/build:
	@$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); bash tools/viewer_image_build.sh "$$VIEWER_IMAGE"

define production_viewer_compose
@$(LANE_GUARD); \
if [[ ! "$$VIEWER_PORT" =~ ^[1-9][0-9]{3,4}$$ || "$$VIEWER_PORT" -lt 1024 || "$$VIEWER_PORT" -gt 65535 ]]; then printf '%s\n' 'VIEWER_PORT must be an integer from 1024 to 65535.' >&2; exit 2; fi; \
$(DOCKER_COMPOSE) --env-file /dev/null -p "$$VIEWER_COMPOSE_PROJECT_NAME" -f $(COMPOSE_DIR)/viewer.yml $(1)
endef

viewer/up:
	$(call production_viewer_compose,up -d --no-build --pull never --wait --wait-timeout 30)

viewer/down:
	$(call production_viewer_compose,down --timeout 10)

viewer/status:
	$(call production_viewer_compose,ps)

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
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME),$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES),$$status); \
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
	  $(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME),$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES),$$status); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES) \
	  up --build --abort-on-container-exit --exit-code-from test-integration-fuzz-with-writes-bike-nft test-integration-fuzz-with-writes-bike-nft

bike-nft/local/integration/fuzz/down:
	@$(LANE_GUARD); \
	$(CAM_INTEGRATION_INPUT_GUARD); \
	cleanup_status=0; \
	$(TEST_INTEGRATION_FUZZ_BIKE_NFT_ENV) env -u PRIVATE_KEY $(call disposable_cleanup_command,$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME),$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES)) || cleanup_status="$$?"; \
	$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_ENV) env -u PRIVATE_KEY $(call disposable_cleanup_command,$(TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME),$(TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_FILES)) || { next_cleanup_status="$$?"; if [[ "$$cleanup_status" == 0 ]]; then cleanup_status="$$next_cleanup_status"; fi; }; \
	exit "$$cleanup_status"

dapps/tests/coverage: dapps/deps/verify
	$(call compose_run,forge.yml,forge-coverage)

dapps/tests: dapps/tests/unit-scenario dapps/tests/fuzz dapps/tests/invariant

tests: tests/checks dapps/tests js/ci tests/live cast/offline/check wallet/addresses/check pay-to-play/local/recovery/run escrow/local/scenario/run bike-nft/local/integration/fuzz/run bike-nft/local/integration/fuzz/fixture-writes/run dapps/release/rehearsal/check

release/rpc/list:
	@cat js/packages/cam-viewer/src/rpc-catalog.json

dapps/release/rehearsal/check:
	@for app in bike-nft escrow pay-to-play; do $(MAKE) "$$app/release/rehearsal/run" RPC_URL_FILE=/must-not-use-parent-rpc DEPLOYER_PRIVATE_KEY_FILE=/must-not-use-parent-key || exit "$$?"; done

define release_rehearsal
	@$(LANE_GUARD); $(SOLDEER_DEPS_GUARD); $(PACKAGE_DEPS_GUARD); \
	env -u CONFIG bash tools/release_rehearsal.sh "$(firstword $(subst /, ,$@))" "$(DOCKER_COMPOSE)" release
endef

.PHONY: dapps/release/rehearsal/check bike-nft/release/rehearsal/run escrow/release/rehearsal/run pay-to-play/release/rehearsal/run
bike-nft/release/rehearsal/run:
	$(release_rehearsal)

escrow/release/rehearsal/run:
	$(release_rehearsal)

.PHONY: escrow/release/approval-wait/check
escrow/release/approval-wait/check:
	@$(LANE_GUARD); $(SOLDEER_DEPS_GUARD); $(PACKAGE_DEPS_GUARD); \
	env -u CONFIG bash tools/release_rehearsal.sh escrow "$(DOCKER_COMPOSE)" waits

.PHONY: escrow/release/ipc-approval-wait/check
escrow/release/ipc-approval-wait/check:
	@$(LANE_GUARD); $(SOLDEER_DEPS_GUARD); $(PACKAGE_DEPS_GUARD); \
	env -u CONFIG bash tools/release_rehearsal.sh escrow "$(DOCKER_COMPOSE)" ipc-waits

.PHONY: escrow/release/approval/start/check escrow/release/approval/success/check
.PHONY: bike-nft/release/approval/start/check bike-nft/release/approval/success/check pay-to-play/release/approval/start/check pay-to-play/release/approval/success/check
define release_approval_rehearsal
	@$(LANE_GUARD); $(SOLDEER_DEPS_GUARD); $(PACKAGE_DEPS_GUARD); \
	timeout -s TERM -k 420s 600s env -u CONFIG bash tools/release_rehearsal.sh "$(firstword $(subst /, ,$@))" "$(DOCKER_COMPOSE)" $(1)
endef

escrow/release/approval/start/check:
	$(call release_approval_rehearsal,approval-pty)

escrow/release/approval/success/check:
	$(call release_approval_rehearsal,approval-success)

bike-nft/release/approval/start/check:
	$(call release_approval_rehearsal,approval-pty)

bike-nft/release/approval/success/check:
	$(call release_approval_rehearsal,approval-success)

pay-to-play/release/approval/start/check:
	$(call release_approval_rehearsal,approval-pty)

pay-to-play/release/approval/success/check:
	$(call release_approval_rehearsal,approval-success)

pay-to-play/release/rehearsal/run:
	$(release_rehearsal)

define local_release_compose
LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$(LOCAL_RELEASE_PROJECT)" \
RELEASE_REHEARSAL_NETWORK="$(LOCAL_RELEASE_NETWORK)" $(DOCKER_COMPOSE) \
-f $(COMPOSE_DIR)/release/local-network.yml --profile internal $(1)
endef

.PHONY: network/local/up network/local/info network/local/status network/local/down
network/local/up:
	@$(LANE_GUARD); \
	$(call local_release_compose,up --build --detach --wait --wait-timeout 90 release-anvil release-cam); \
	$(MAKE) --no-print-directory network/local/info

network/local/info:
	@$(LANE_GUARD); \
	for service in release-anvil release-cam; do \
	  running="$$( $(call local_release_compose,ps --quiet --status running) "$$service" )"; \
	  if [[ -z "$$running" ]]; then printf '%s\n' 'Local release network is not running; run make network/local/up.' >&2; exit 2; fi; \
	done; \
	printf '%s\n' 'Local release network: chain 31338' 'Docker network: $(LOCAL_RELEASE_NETWORK)' \
	  'RPC URL: http://release-anvil:8545' 'CAM base URL: http://release-cam:8080' \
	  'These URLs work only inside this Docker network. CAM uses HTTP, not HTTPS.' \
	  'No host ports are published; your host browser cannot open the CAM URL.' \
	  'Select local in <app>/release/setup. The network stays running until network/local/down.'

network/local/status:
	@$(LANE_GUARD); \
	printf '%s\n' 'Local release services: $(LOCAL_RELEASE_PROJECT) (no rows means no containers exist)'; \
	$(call local_release_compose,ps --all --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' release-anvil release-cam)

network/local/down:
	@$(LANE_GUARD); \
	$(call local_release_compose,down --volumes --remove-orphans)

LOCAL_RELEASE_VIEWER_COMPOSE_FILES := -f $(COMPOSE_DIR)/release/viewer.yml -f $(COMPOSE_DIR)/release/viewer-local.yml

define local_release_viewer_compose
LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$(LOCAL_RELEASE_PROJECT)-viewer" \
RELEASE_LOCAL_NETWORK="$(LOCAL_RELEASE_NETWORK)" RELEASE_VIEWER_ORIGIN="http://127.0.0.1:$$RELEASE_VIEWER_PORT" \
RELEASE_VIEWER_APP="$$viewer_app" RELEASE_VIEWER_ARTIFACT="$$viewer_artifact" \
RELEASE_VIEWER_RPC_URL="http://127.0.0.1:$$RELEASE_VIEWER_PORT/rpc" \
RELEASE_VIEWER_RESOURCE_ORIGIN="$$viewer_resource_origin" $(DOCKER_COMPOSE) $(LOCAL_RELEASE_VIEWER_COMPOSE_FILES) $(1)
endef

define public_release_viewer_compose
LOCAL_UID="$(LOCAL_UID)" LOCAL_GID="$(LOCAL_GID)" COMPOSE_PROJECT_NAME="$(RELEASE_VIEWER_COMPOSE_PROJECT_NAME)" \
RELEASE_VIEWER_ORIGIN="http://127.0.0.1:$$RELEASE_VIEWER_PORT" \
RELEASE_VIEWER_APP="$$viewer_app" RELEASE_VIEWER_ARTIFACT="$$viewer_artifact" \
RELEASE_VIEWER_RPC_URL="$$viewer_rpc" RELEASE_VIEWER_RESOURCE_ORIGIN="$$viewer_resource_origin" \
RELEASE_VIEWER_INTERACTIVE="$${viewer_interactive-0}" \
$(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/release/viewer.yml $(1)
endef

define release_viewer_artifact
viewer_artifact="$${DEPLOYMENT_ARTIFACT_FILE-}"; \
if [[ -z "$$viewer_artifact" ]]; then \
  if [[ ! -t 0 ]]; then printf '%s\n' 'Set DEPLOYMENT_ARTIFACT_FILE to deployment.json, or run this command in an interactive terminal.' >&2; exit 2; fi; \
  while true; do \
    if ! read -r -e -p 'Deployment artifact (absolute path to deployment.json): ' viewer_artifact; then printf '%s\n' 'Viewer setup ended before an artifact was selected.' >&2; exit 2; fi; \
    if ( require_release_file "$$viewer_artifact" DEPLOYMENT_ARTIFACT_FILE ); then break; fi; \
  done; \
else require_release_file "$$viewer_artifact" DEPLOYMENT_ARTIFACT_FILE; fi
endef

define release_viewer_settings
viewer_interactive=0; if [[ -t 0 ]]; then viewer_interactive=1; fi; \
printf '%s\n' 'Reading the deployment artifact and preparing viewer options...' >&2; \
viewer_settings="$$( $(1) )"; \
mapfile -t viewer_inputs <<< "$$viewer_settings"; \
if [[ "$${#viewer_inputs[@]}" != 4 ]]; then printf '%s\n' 'Viewer setup did not return its four connection fields.' >&2; exit 2; fi; \
viewer_app="$${viewer_inputs[0]}"; viewer_resource_origin="$${viewer_inputs[1]}"; viewer_rpc="$${viewer_inputs[2]}"; viewer_url="$${viewer_inputs[3]}"; \
viewer_interactive=0
endef

.PHONY: viewer/release/up viewer/release/down
viewer/release/up:
	@$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); $(release_host_guard_functions); \
	$(call release_instance_entry,_,viewer/up); \
	viewer_app="$${APP-}"; $(release_viewer_artifact); \
	viewer_resource_origin="$${RESOURCE_ORIGIN-}"; viewer_rpc="$${PUBLIC_RPC_URL-}"; \
	if [[ ! "$$RELEASE_VIEWER_PORT" =~ ^[1-9][0-9]{0,4}$$ || "$$RELEASE_VIEWER_PORT" -gt 65535 ]]; then printf '%s\n' 'RELEASE_VIEWER_PORT must be a TCP port in 1..65535.' >&2; exit 2; fi; \
	viewer_containers="$$( $(call public_release_viewer_compose,ps --all --quiet) )"; \
	if [[ -n "$$viewer_containers" ]]; then printf '%s\n' 'This viewer project already has containers; stop it with viewer/release/down or select another RELEASE_VIEWER_COMPOSE_PROJECT_NAME.' >&2; exit 2; fi; \
	$(call release_viewer_settings,$(call public_release_viewer_compose,run --build --quiet-build --rm --no-deps -T viewer-url)); \
	printf 'Open this URL in your browser:\n%s\nNo wallet is attached. Connect your wallet to send transactions.\n' "$$viewer_url"; \
	cleanup() { $(call public_release_viewer_compose,down --timeout 10); }; \
	trap cleanup EXIT; \
	$(call public_release_viewer_compose,up --build --abort-on-container-exit cam-web browser-gateway)

viewer/release/down:
	@$(LANE_GUARD); $(release_host_guard_functions); $(call release_instance_entry,_,viewer/down); viewer_app=unused; viewer_artifact=/dev/null; \
	viewer_resource_origin=https://unused.invalid; viewer_rpc=https://unused.invalid; \
	$(call public_release_viewer_compose,down --timeout 10)

.PHONY: network/local/viewer/up network/local/viewer/down
network/local/viewer/up:
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(release_host_guard_functions); \
	viewer_app="$${APP:?Set APP to bike-nft, escrow or pay-to-play}"; \
	case "$$viewer_app" in bike-nft|escrow|pay-to-play) ;; *) printf '%s\n' 'APP must be bike-nft, escrow or pay-to-play.' >&2; exit 2 ;; esac; \
	viewer_artifact="$${DEPLOYMENT_ARTIFACT_FILE:?Set DEPLOYMENT_ARTIFACT_FILE}"; \
	require_release_file "$$viewer_artifact" DEPLOYMENT_ARTIFACT_FILE; \
	viewer_resource_origin="$${RESOURCE_ORIGIN:?Set RESOURCE_ORIGIN to an initial download scope or URL prefix}"; \
	port="$$RELEASE_VIEWER_PORT"; \
	if [[ ! "$$port" =~ ^[1-9][0-9]{0,4}$$ || "$$port" -gt 65535 ]]; then printf '%s\n' 'RELEASE_VIEWER_PORT must be a TCP port in 1..65535.' >&2; exit 2; fi; \
	RELEASE_REHEARSAL_NETWORK="$(LOCAL_RELEASE_NETWORK)"; require_release_local_network; \
	running="$$( $(call local_release_compose,ps --quiet --status running release-anvil) )"; \
	if [[ -z "$$running" ]]; then printf '%s\n' 'Local release chain is not running; run make network/local/up.' >&2; exit 2; fi; \
	$(call release_viewer_settings,$(call local_release_viewer_compose,run --build --quiet-build --rm --no-deps -T viewer-url)); \
	printf 'Open this URL in your browser:\n%s\nFixture RPC permits local test transactions; no wallet is attached.\n' "$$viewer_url"; \
	cleanup() { $(call local_release_viewer_compose,down --timeout 10); }; \
	trap cleanup EXIT; \
	$(call local_release_viewer_compose,up --build --abort-on-container-exit cam-web browser-gateway)

# Compose still interpolates service inputs during down; none of these render
# placeholders are used to run a service or replace operator deployment inputs.
network/local/viewer/down:
	@$(LANE_GUARD); \
	viewer_app=unused; viewer_artifact=/dev/null; viewer_resource_origin=https://unused.invalid; \
	$(call local_release_viewer_compose,down --timeout 10)

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

define wallet_interactive
$(LANE_GUARD); \
if [[ ! -t 0 || ! -t 1 ]]; then printf '%s\n' 'Run make $@ in an interactive terminal.' >&2; exit 2; fi; \
$(call wallet_compose,run --build --rm --no-deps wallet-addresses bash --noprofile --norc /tool/wallet_addresses.sh $(1))
endef

wallet/addresses:
	@$(call wallet_interactive,)

wallet/addresses/with-keys:
	@$(call wallet_interactive,--with-keys)

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
	  $(RPC_COMPOSE_ENV) RPC_URL_FILE="$$rpc_url_file" env -u RPC_URL -u MAKEFLAGS -u MFLAGS -u MAKEOVERRIDES $(call cleanup_disposable_project,$(RPC_COMPOSE_PROJECT_NAME),-f $(COMPOSE_DIR)/cast.yml,$$status); \
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

rpc/indexer/up:
	@$(LANE_GUARD); \
	$(release_host_guard_functions); \
	require_protected_release_file "$${RPC_URL_FILE:?Set RPC_URL_FILE}" RPC_URL_FILE RPC_URL_FILE; \
	case "$$RPC_URL_FILE" in */./*|*/../*|*//*) printf '%s\n' 'RPC_URL_FILE must be a normalized absolute path.' >&2; exit 2 ;; esac; \
	case "$$RPC_URL_FILE" in "$$(pwd -P)"/*) printf '%s\n' 'RPC_URL_FILE must be outside the repository.' >&2; exit 2 ;; esac; \
	if [[ "$$(stat -c %u -- "$$RPC_URL_FILE")" != "$(LOCAL_UID)" ]]; then printf '%s\n' 'RPC_URL_FILE must be owned by LOCAL_UID so the proxy can read it.' >&2; exit 2; fi; \
	$(RPC_INDEXER_COMPOSE_ENV) RPC_URL_FILE="$$RPC_URL_FILE" env -u RPC_URL -u MAKEFLAGS -u MFLAGS -u MAKEOVERRIDES $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/rpc-indexer.yml up --build -d --wait --wait-timeout 30 rpc-proxy; \
	printf 'Client network: %s_rpc_internal\nRPC URL: http://%s-rpc:8080\n' "$(RPC_INDEXER_COMPOSE_PROJECT_NAME)" "$(RPC_INDEXER_COMPOSE_PROJECT_NAME)"

rpc/indexer/logs:
	@$(LANE_GUARD); \
	$(RPC_INDEXER_COMPOSE_ENV) RPC_URL_FILE=/dev/null $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/rpc-indexer.yml logs --tail 100 rpc-proxy

rpc/indexer/down:
	@$(LANE_GUARD); \
	$(RPC_INDEXER_COMPOSE_ENV) RPC_URL_FILE=/dev/null $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/rpc-indexer.yml down

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
	  $(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME),$(BIKE_NFT_LOCAL_COMPOSE_FILES),$$status); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) $(BIKE_NFT_LOCAL_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from deploy-bike-nft-local deploy-bike-nft-local

bike-nft/local/demo/terminal/up: dapps/deps/verify
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME),$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES),$$status); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES) \
	  run --build --rm bike-nft-viewer-terminal

bike-nft/local/demo/terminal/down:
	@$(LANE_GUARD); \
	$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME),$(BIKE_NFT_VIEWER_TERMINAL_COMPOSE_FILES),0)

bike-nft/local/demo/gui/up: dapps/deps/verify
	@$(LANE_GUARD); \
	$(BIKE_NFT_GUI_BIND_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME),$(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES),$$status); \
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
	$(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME),$(BIKE_NFT_VIEWER_GUI_COMPOSE_FILES),0)

escrow/local/scenario/run: dapps/deps/verify
	@$(LANE_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(ESCROW_LOCAL_SCENARIO_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(ESCROW_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME),$(ESCROW_LOCAL_SCENARIO_COMPOSE_FILES),$$status); \
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
	  $(ESCROW_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(ESCROW_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME),$(ESCROW_VIEWER_TERMINAL_COMPOSE_FILES),$$status); \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(ESCROW_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) \
	  $(ESCROW_VIEWER_TERMINAL_COMPOSE_FILES) \
	  run --build --rm escrow-viewer-terminal

escrow/local/demo/terminal/down:
	@$(LANE_GUARD); \
	$(ESCROW_VIEWER_TERMINAL_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(ESCROW_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME),$(ESCROW_VIEWER_TERMINAL_COMPOSE_FILES),0)

escrow/local/demo/gui/up: dapps/deps/verify
	@$(LANE_GUARD); \
	$(ESCROW_GUI_BIND_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(ESCROW_VIEWER_GUI_COMPOSE_PROJECT_NAME),$(ESCROW_VIEWER_GUI_COMPOSE_FILES),$$status); \
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
	$(ESCROW_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(ESCROW_VIEWER_GUI_COMPOSE_PROJECT_NAME),$(ESCROW_VIEWER_GUI_COMPOSE_FILES),0)

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

define release_setup
$(LANE_GUARD); \
app="$(patsubst %/release/setup,%,$@)"; \
$(release_host_guard_functions); \
$(call release_instance_entry,$(patsubst %/release/setup,%,$@),setup); \
validate_new_release_output "$${CONFIG:?Set CONFIG to a new absolute off-repo file}" CONFIG; \
source_commit="$$(git rev-parse HEAD)"; \
release_config_stage "$$(dirname -- "$$CONFIG")"; \
$(release_config_compose); \
$(release_setup_rpc_compose); \
source tools/release_approval_preflight.sh; \
release_config_prepare_approval_images; \
compose_release_config run --rm --no-deps release-setup network "$$app" "$$source_commit"; \
read -r setup_network < "$$release_config_dir/setup-network"; \
if [[ "$$setup_network" == public ]]; then release_config_probe_chain "$(CURDIR)" "$$source_commit"; fi; \
compose_release_config run --rm --no-deps release-setup setup "$$app" "$$source_commit"; \
release_config_input="$$release_config_dir/release.json"; \
require_release_config "$$release_config_input"; \
setup_mode=deploy; \
case "$${RELEASE_SETUP_PURPOSE:-deployment}" in ui) setup_mode=ui-deploy ;; contracts) setup_mode=contracts-deploy ;; cam) setup_mode=cam-publish ;; esac; \
compose_release_config run --rm --no-deps -T release-config "$$setup_mode" "$$app" "$$source_commit"; \
mapfile -d '' -t inputs < "$$release_config_dir/inputs"; \
export "$${inputs[@]}"; \
release_approval_require_image; \
if [[ "$$RELEASE_REHEARSAL" == 1 ]]; then require_release_local_network; fi; \
if [[ -n "$${OUTPUT_DIR-}" ]]; then validate_new_release_output "$$OUTPUT_DIR" OUTPUT_DIR; fi; \
recheck_new_release_output "$$CONFIG" CONFIG; \
ln -T -- "$$release_config_input" "$$CONFIG"; \
printf 'Saved release configuration: %s\nNo transactions were sent.\n' "$$CONFIG"; \
printf 'Configuration pins source commit %s.\n' "$$source_commit"

endef

.PHONY: bike-nft/release/setup escrow/release/setup pay-to-play/release/setup
bike-nft/release/setup:
	@$(release_setup)

escrow/release/setup:
	@$(release_setup)

pay-to-play/release/setup:
	@$(release_setup)

escrow/release/deploy:
	@$(call release_full,escrow,full)

escrow/release/verify:
	@$(call release_full,escrow,verify)

bike-nft/release/deploy:
	@$(call release_full,bike-nft,full)

bike-nft/release/verify:
	@$(call release_full,bike-nft,verify)

.PHONY: pay-to-play/release/check pay-to-play/release/deploy pay-to-play/release/verify
.PHONY: bike-nft/release/contracts/deploy escrow/release/contracts/deploy pay-to-play/release/contracts/deploy
.PHONY: bike-nft/release/contracts/artifact escrow/release/contracts/artifact pay-to-play/release/contracts/artifact
bike-nft/release/contracts/deploy escrow/release/contracts/deploy pay-to-play/release/contracts/deploy:
	@$(release_contracts_deploy)

bike-nft/release/contracts/artifact escrow/release/contracts/artifact pay-to-play/release/contracts/artifact:
	@$(release_contracts_artifact)

.PHONY: bike-nft/release/ui/deploy escrow/release/ui/deploy pay-to-play/release/ui/deploy
.PHONY: bike-nft/release/ui/artifact escrow/release/ui/artifact pay-to-play/release/ui/artifact
bike-nft/release/ui/deploy escrow/release/ui/deploy pay-to-play/release/ui/deploy:
	@$(release_ui_deploy)

bike-nft/release/ui/artifact escrow/release/ui/artifact pay-to-play/release/ui/artifact:
	@$(release_ui_artifact)

.PHONY: bike-nft/release/ui/update escrow/release/ui/update pay-to-play/release/ui/update
bike-nft/release/ui/update escrow/release/ui/update pay-to-play/release/ui/update:
	@$(call release_full,$(patsubst %/release/ui/update,%,$@),update)

pay-to-play/release/deploy:
	@$(call release_full,pay-to-play,full)

pay-to-play/release/verify:
	@$(call release_full,pay-to-play,verify)

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
	  $(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_PROJECT_NAME),$(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES),$$status); \
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
	  $(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_PROJECT_NAME),$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES),$$status); \
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
	$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_ENV) env -u PRIVATE_KEY $(call cleanup_disposable_project,$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_PROJECT_NAME),$(PAY_TO_PLAY_VIEWER_GUI_COMPOSE_FILES),0)


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
	EXPECTED_CONTRACT_ADDRESSES="$${EXPECTED_CONTRACT_ADDRESSES:?Set EXPECTED_CONTRACT_ADDRESSES}" \
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

.PHONY: bike-nft/release/cam/bundle escrow/release/cam/bundle pay-to-play/release/cam/bundle
bike-nft/release/cam/bundle escrow/release/cam/bundle pay-to-play/release/cam/bundle:
	@$(release_cam_bundle)

.PHONY: bike-nft/release/cam/publish escrow/release/cam/publish pay-to-play/release/cam/publish
bike-nft/release/cam/publish escrow/release/cam/publish pay-to-play/release/cam/publish:
	@$(release_cam_publish)
.PHONY: bike-nft/release/cam/artifact escrow/release/cam/artifact pay-to-play/release/cam/artifact
bike-nft/release/cam/artifact escrow/release/cam/artifact pay-to-play/release/cam/artifact:
	@$(call release_independent_artifact,CAM_RECORDS,cam,CAM,cam,$(CAM_RELEASE_ARTIFACT_COMPOSE_FILES))
