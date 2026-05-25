SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE_DIR ?= compose
DOCKER_COMPOSE ?= docker compose
COMPOSE_PROJECT_NAME ?= dapps
DAPPS_DIR := dapps
PACKAGES_DIR := packages
DEPENDENCIES_DIR := $(DAPPS_DIR)/dependencies
FOUNDRY_MANIFEST_FILE := $(DAPPS_DIR)/foundry.toml
DEPENDENCY_METADATA_FILES := $(DAPPS_DIR)/soldeer.lock $(DAPPS_DIR)/remappings.txt $(DAPPS_DIR)/dependency-checksums.txt
PACKAGE_MANIFEST_FILE := $(PACKAGES_DIR)/package.json
PACKAGE_NODE_MODULES_DIR := $(PACKAGES_DIR)/node_modules
PACKAGE_LOCK_FILE := $(PACKAGES_DIR)/package-lock.json
ACTUAL_UID := $(shell id -u)
LOCAL_UID ?= $(shell id -u)
LOCAL_GID ?= $(shell id -g)
ALLOW_UPDATE ?= 0

RPC_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-cast-rpc
ANVIL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-anvil
LIVE_CHECK_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-check-live
BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-bike-nft-local
VIEWER_TERMINAL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-viewer-terminal
VIEWER_TERMINAL_CONTAINER_NAME ?= $(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME)-session

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)
DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
PACKAGE_DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
RPC_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_COMPOSE_PROJECT_NAME)
ANVIL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(ANVIL_COMPOSE_PROJECT_NAME)
LIVE_CHECK_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(LIVE_CHECK_COMPOSE_PROJECT_NAME)
BIKE_NFT_LOCAL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME)
VIEWER_TERMINAL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME) VIEWER_TERMINAL_CONTAINER_NAME=$(VIEWER_TERMINAL_CONTAINER_NAME)
ANVIL_INTERNAL_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=internal
ANVIL_HOST_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=host
ANVIL_ALL_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=internal,host
LIVE_DEPS_EGRESS_COMPOSE_FILES := -f $(COMPOSE_DIR)/deps.yml -f $(COMPOSE_DIR)/check-live-deps-egress.yml
NON_ROOT_GUARD := if [[ "$(ACTUAL_UID)" == "0" || "$(LOCAL_UID)" == "0" ]]; then printf '%s\n' 'Refusing to run Docker lanes as root or with LOCAL_UID=0. Run make as a non-root user.' >&2; exit 2; fi

define compose_run
@$(NON_ROOT_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

PACKAGE_DEPS_GUARD := if [[ ! -d "$(PACKAGE_NODE_MODULES_DIR)" || ! -f "$(PACKAGE_LOCK_FILE)" ]]; then printf '%s\n' 'Missing npm workspace dependencies. Run make package-deps to install the locked package dependencies.' >&2; exit 2; fi

define compose_run_with_package_deps
@$(NON_ROOT_GUARD); \
$(PACKAGE_DEPS_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

.PHONY: help deps deps-verify package-deps package-graph-check package-build package-build-check package-test package-ci viewer-terminal-check checks check-runtime check-live check-live-deps-egress viewer-terminal viewer-terminal-status viewer-terminal-attach viewer-terminal-down check-anvil-compose fmt build script-build abi test fuzz invariant coverage ci cast-offline cast-rpc anvil-internal anvil-host anvil-down anvil bike-nft-local-deploy

help:
	@printf '%s\n' \
	  'Supported lanes:' \
	  '  make deps         Install only the currently locked Soldeer dependencies' \
	  '  make deps ALLOW_UPDATE=1  Allow dependency lock/remapping/checksum updates' \
	  '  make deps-verify  Verify installed dependencies against committed checksums' \
	  '  make package-deps Install only the currently locked npm workspace dependencies' \
	  '  make package-deps ALLOW_UPDATE=1  Allow package-lock.json updates' \
	  '  make package-graph-check  Check installed npm dependency graph offline' \
	  '  make package-build-check  Validate npm workspace package builds offline' \
	  '  make package-test   Build and test npm workspace packages offline' \
	  '  make package-ci     Run package tests and mock viewer terminal checks offline' \
	  '  make viewer-terminal-check  Smoke-check the mock CAM viewer terminal offline' \
	  '  make viewer-terminal  Run the mock-backed CAM viewer terminal offline' \
	  '  make viewer-terminal-status  Show mock viewer terminal Compose status' \
	  '  make viewer-terminal-attach  Attach if the mock viewer terminal is still running' \
	  '  make viewer-terminal-down    Stop and clean up the mock viewer terminal Compose project' \
	  '  make checks       Run offline repository/source checks' \
	  '  make check-runtime  Run local Docker-backed runtime checks' \
	  '  make check-live    Run live checks that intentionally use external network' \
	  '  make check-live-deps-egress  Prove dependency egress allow/deny behavior' \
	  '  make check-anvil-compose  Run only the rendered Anvil Compose posture checks' \
	  '  make fmt          Check Solidity formatting for all dapps' \
	  '  make build        Compile all dapp source trees' \
	  '  make script-build Compile all dapp deployment scripts without executing them' \
	  '  make abi          Export dapps/<name>/src/*.sol ABIs into existing cam/abi directories' \
	  '  make test         Run unit tests for all dapps' \
	  '  make fuzz         Run fuzz tests for all dapps' \
	  '  make invariant    Run invariant tests for all dapps' \
	  '  make coverage     Print coverage summary from all dapp unit tests' \
	  '  make ci           Run fmt, build, script-build, unit, fuzz, invariant, and package-ci lanes' \
	  '  make cast-offline Run offline cast smoke lane' \
	  '  make cast-rpc RPC_URL_FILE=/path  Read a block number through the RPC egress proxy' \
	  '  RPC_URL=https://... make cast-rpc  Same, using a temporary secret file' \
	  '  make anvil-internal  Start Docker-only Anvil with no host port' \
	  '  make anvil-host      Start Anvil on 127.0.0.1:$${ANVIL_HOST_PORT:-8545}' \
	  '  make anvil-down      Stop Anvil services and remove their network' \
	  '  make bike-nft-local-deploy CAM_URI=... BIKE_NFT_PRIVATE_KEY_FILE=/path  Deploy the bike NFT fixture to an internal Anvil' \
	  '' \
	  'All lanes are Docker-backed. Default check lanes are offline, read-only,' \
	  'non-root, capability-free, and avoid writing build artifacts into the repo.' \
	  'Dependency install lanes are the only guarded host bind-target setup exception.'

deps:
	@$(NON_ROOT_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	  if [[ "$$status" != "0" && -n "$${created_dependency_metadata_placeholders:-}" ]]; then \
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
	case "$(ALLOW_UPDATE)" in \
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
	        created_dependency_metadata_placeholders="$${created_dependency_metadata_placeholders:-} $$file"; \
	      fi; \
	    done ;; \
	  *) printf '%s\n' 'ALLOW_UPDATE must be 0 or 1.' >&2; exit 2 ;; \
	esac; \
	reject_unsafe_dependency_targets; \
	mkdir -p $(DEPENDENCIES_DIR); \
	test -d $(DEPENDENCIES_DIR); \
	reject_unsafe_dependency_targets; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-stage; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify-stage; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm "$$apply_service"; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify

deps-verify:
	$(call compose_run,deps.yml,soldeer-verify)

package-deps:
	@$(NON_ROOT_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  if [[ -n "$${package_input_dir:-}" ]]; then \
	    $(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	    rm -rf "$$package_input_dir"; \
	  fi; \
	  if [[ "$$status" != "0" && "$${created_package_lock_placeholder:-0}" == "1" ]]; then \
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
	case "$(ALLOW_UPDATE)" in \
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
	  package_dir="$${manifest%/package.json}"; \
	  package_dir="$${package_dir#$(PACKAGES_DIR)/}"; \
	  mkdir -p "$$package_input_dir/$$package_dir"; \
	  cp "$$manifest" "$$package_input_dir/$$package_dir/package.json"; \
	done < <(find $(PACKAGES_DIR) -mindepth 2 -maxdepth 2 -name package.json -type f | sort); \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml run --build --rm package-stage; \
	reject_unsafe_package_targets; \
	mkdir -p "$(PACKAGE_NODE_MODULES_DIR)"; \
	test -d "$(PACKAGE_NODE_MODULES_DIR)"; \
	if [[ "$(ALLOW_UPDATE)" = "1" && ! -e "$(PACKAGE_LOCK_FILE)" ]]; then \
	  touch "$(PACKAGE_LOCK_FILE)"; \
	  created_package_lock_placeholder=1; \
	fi; \
	test -f "$(PACKAGE_LOCK_FILE)"; \
	reject_unsafe_package_targets; \
	$(PACKAGE_DEPS_COMPOSE_ENV) PACKAGE_INPUT_DIR="$$package_input_dir" $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/package-deps.yml run --build --rm "$$apply_service"

package-graph-check:
	$(call compose_run_with_package_deps,packages.yml,package-graph-check)

package-build:
	@printf '%s\n' 'make package-build is intentionally undefined as an artifact-producing lane.' >&2
	@printf '%s\n' 'Use make package-build-check to validate TypeScript package compilation in container-local tmpfs.' >&2
	@exit 2

package-build-check: package-graph-check
	$(call compose_run_with_package_deps,packages.yml,package-build-check)

package-test: package-graph-check
	$(call compose_run_with_package_deps,packages.yml,package-test)

package-ci: package-test viewer-terminal-check

viewer-terminal-check: package-graph-check
	@$(NON_ROOT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml run --build --rm -T viewer-terminal-check

viewer-terminal: package-graph-check
	@$(NON_ROOT_GUARD); \
	$(PACKAGE_DEPS_GUARD); \
	if $(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml ps --all --quiet viewer-terminal | grep -q .; then \
	  printf 'Viewer terminal container already exists: %s\n' "$(VIEWER_TERMINAL_CONTAINER_NAME)" >&2; \
	  printf '%s\n' 'Use make viewer-terminal-attach or make viewer-terminal-down.' >&2; \
	  exit 2; \
	fi; \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml run --build --rm viewer-terminal

viewer-terminal-status:
	@$(NON_ROOT_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml ps --all viewer-terminal

viewer-terminal-attach:
	@$(NON_ROOT_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml attach viewer-terminal

viewer-terminal-down:
	@$(NON_ROOT_GUARD); \
	$(VIEWER_TERMINAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/viewer-terminal.yml down --volumes --remove-orphans >/dev/null 2>&1 || true

checks:
	$(call compose_run,checks.yml,checks)

check-runtime: check-anvil-compose

check-live: check-live-deps-egress

check-live-deps-egress:
	@$(NON_ROOT_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(LIVE_CHECK_COMPOSE_ENV) $(DOCKER_COMPOSE) $(LIVE_DEPS_EGRESS_COMPOSE_FILES) up --build --abort-on-container-exit --exit-code-from egress-proxy-check egress-proxy-check

check-anvil-compose:
	@$(NON_ROOT_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/checks.yml run --build --rm checks -I -B -m unittest discover -s tests/checks -t . -p test_anvil_compose.py

fmt:
	$(call compose_run,forge.yml,forge-fmt)

build: deps-verify
	$(call compose_run,forge.yml,forge-build)

script-build: deps-verify
	$(call compose_run,forge.yml,forge-script-build)

abi: deps-verify
	$(call compose_run,forge.yml,forge-abi)

test: deps-verify checks
	$(call compose_run,forge.yml,forge-test)

fuzz: deps-verify
	$(call compose_run,forge.yml,forge-fuzz)

invariant: deps-verify
	$(call compose_run,forge.yml,forge-invariant)

coverage: deps-verify
	$(call compose_run,forge.yml,forge-coverage)

ci: fmt build script-build test fuzz invariant package-ci

cast-offline:
	$(call compose_run,cast.yml,cast-offline)

cast-rpc:
	@$(NON_ROOT_GUARD); \
	if [[ -n "$${RPC_URL:-}" && -n "$${RPC_URL_FILE:-}" ]]; then \
	  printf '%s\n' 'Set only one of RPC_URL or RPC_URL_FILE.' >&2; \
	  exit 2; \
	fi; \
	tmp_dir="$$(mktemp -d)"; \
	chmod 0700 "$$tmp_dir"; \
	rpc_url_file="$$tmp_dir/rpc_url"; \
	cleanup() { \
	  status="$$?"; \
	  $(RPC_COMPOSE_ENV) RPC_URL_FILE="$$rpc_url_file" env -u RPC_URL -u MAKEFLAGS -u MFLAGS -u MAKEOVERRIDES $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/cast.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	  rm -rf "$$tmp_dir"; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	if [[ -n "$${RPC_URL_FILE:-}" ]]; then \
	  if [[ ! -r "$$RPC_URL_FILE" ]]; then \
	    printf 'RPC_URL_FILE is not readable: %s\n' "$$RPC_URL_FILE" >&2; \
	    exit 2; \
	  fi; \
	  cp -- "$$RPC_URL_FILE" "$$rpc_url_file"; \
	elif [[ -n "$${RPC_URL:-}" ]]; then \
	  printf '%s' "$$RPC_URL" > "$$rpc_url_file"; \
	else \
	  printf '%s\n' 'Set RPC_URL_FILE=/path/to/rpc-url, or set RPC_URL for temporary use.' >&2; \
	  exit 2; \
	fi; \
	chmod 0444 "$$rpc_url_file"; \
	$(RPC_COMPOSE_ENV) RPC_URL_FILE="$$rpc_url_file" env -u RPC_URL -u MAKEFLAGS -u MFLAGS -u MAKEOVERRIDES $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/cast.yml up --build --abort-on-container-exit --exit-code-from cast-rpc cast-rpc

anvil-internal:
	@$(NON_ROOT_GUARD); \
	$(ANVIL_INTERNAL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil-internal

anvil-host:
	@$(NON_ROOT_GUARD); \
	$(ANVIL_HOST_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil-host

anvil-down:
	@$(NON_ROOT_GUARD); \
	$(ANVIL_ALL_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml down --volumes --remove-orphans

anvil:
	@printf '%s\n' 'Choose an explicit Anvil access boundary: make anvil-internal or make anvil-host.' >&2
	@exit 2

bike-nft-local-deploy: deps-verify
	@$(NON_ROOT_GUARD); \
	if [[ -z "$${CAM_URI:-}" ]]; then \
	  printf '%s\n' 'Set CAM_URI to the CAM document URI for the local fixture.' >&2; \
	  exit 2; \
	fi; \
	if [[ -z "$${BIKE_NFT_PRIVATE_KEY_FILE:-}" ]]; then \
	  printf '%s\n' 'Set BIKE_NFT_PRIVATE_KEY_FILE to a readable file containing the local deployer private key.' >&2; \
	  exit 2; \
	fi; \
	if [[ ! -r "$$BIKE_NFT_PRIVATE_KEY_FILE" ]]; then \
	  printf 'BIKE_NFT_PRIVATE_KEY_FILE is not readable: %s\n' "$$BIKE_NFT_PRIVATE_KEY_FILE" >&2; \
	  exit 2; \
	fi; \
	cleanup() { \
	  status="$$?"; \
	  $(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/bike-nft-local.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(BIKE_NFT_LOCAL_COMPOSE_ENV) env -u PRIVATE_KEY $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/bike-nft-local.yml up --build --abort-on-container-exit --exit-code-from deploy-bike-nft-local deploy-bike-nft-local
