SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE_DIR ?= compose
DOCKER_COMPOSE ?= docker compose
COMPOSE_PROJECT_NAME ?= dapps
DAPPS_DIR := dapps
DEPENDENCIES_DIR := $(DAPPS_DIR)/dependencies
DEPENDENCY_METADATA_FILES := $(DAPPS_DIR)/soldeer.lock $(DAPPS_DIR)/remappings.txt $(DAPPS_DIR)/dependency-checksums.txt
ACTUAL_UID := $(shell id -u)
LOCAL_UID ?= $(shell id -u)
LOCAL_GID ?= $(shell id -g)
ALLOW_UPDATE ?= 0

RPC_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-cast-rpc
ANVIL_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-anvil
LIVE_CHECK_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-check-live

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)
DEPS_COMPOSE_ENV := $(COMPOSE_ENV) ALLOW_UPDATE=$(ALLOW_UPDATE)
RPC_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_COMPOSE_PROJECT_NAME)
ANVIL_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(ANVIL_COMPOSE_PROJECT_NAME)
LIVE_CHECK_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(LIVE_CHECK_COMPOSE_PROJECT_NAME)
ANVIL_INTERNAL_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=internal
ANVIL_HOST_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=host
ANVIL_ALL_COMPOSE_ENV := $(ANVIL_COMPOSE_ENV) COMPOSE_PROFILES=internal,host
LIVE_DEPS_EGRESS_COMPOSE_FILES := -f $(COMPOSE_DIR)/deps.yml -f $(COMPOSE_DIR)/check-live-deps-egress.yml
NON_ROOT_GUARD := if [[ "$(ACTUAL_UID)" == "0" || "$(LOCAL_UID)" == "0" ]]; then printf '%s\n' 'Refusing to run Docker lanes as root or with LOCAL_UID=0. Run make as a non-root user.' >&2; exit 2; fi

define compose_run
@$(NON_ROOT_GUARD); \
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

.PHONY: help deps deps-verify checks check-runtime check-live check-live-deps-egress check-anvil-compose fmt build abi test fuzz invariant coverage ci cast-offline cast-rpc anvil-internal anvil-host anvil-down anvil

help:
	@printf '%s\n' \
	  'Supported lanes:' \
	  '  make deps         Install only the currently locked Soldeer dependencies' \
	  '  make deps ALLOW_UPDATE=1  Allow dependency lock/remapping/checksum updates' \
	  '  make deps-verify  Verify installed dependencies against committed checksums' \
	  '  make checks       Run offline repository/source checks' \
	  '  make check-runtime  Run local Docker-backed runtime checks' \
	  '  make check-live    Run live checks that intentionally use external network' \
	  '  make check-live-deps-egress  Prove dependency egress allow/deny behavior' \
	  '  make check-anvil-compose  Run only the rendered Anvil Compose posture checks' \
	  '  make fmt          Check Solidity formatting for all dapps' \
	  '  make build        Compile all dapp source trees' \
	  '  make abi          Export dapps/<name>/src/*.sol ABIs into existing cam/abi directories' \
	  '  make test         Run unit tests for all dapps' \
	  '  make fuzz         Run fuzz tests for all dapps' \
	  '  make invariant    Run invariant tests for all dapps' \
	  '  make coverage     Print coverage summary from all dapp unit tests' \
	  '  make ci           Run fmt, build, unit, fuzz, and invariant lanes' \
	  '  make cast-offline Run offline cast smoke lane' \
	  '  make cast-rpc RPC_URL_FILE=/path  Read a block number through the RPC egress proxy' \
	  '  RPC_URL=https://... make cast-rpc  Same, using a temporary secret file' \
	  '  make anvil-internal  Start Docker-only Anvil with no host port' \
	  '  make anvil-host      Start Anvil on 127.0.0.1:$${ANVIL_HOST_PORT:-8545}' \
	  '  make anvil-down      Stop Anvil services and remove their network' \
	  '' \
	  'All lanes are Docker-backed. Default check lanes are offline, read-only,' \
	  'non-root, capability-free, and avoid writing build artifacts into the repo.'

deps:
	@$(NON_ROOT_GUARD); \
	cleanup() { \
	  status="$$?"; \
	  $(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
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
	    touch $(DEPENDENCY_METADATA_FILES) ;; \
	  *) printf '%s\n' 'ALLOW_UPDATE must be 0 or 1.' >&2; exit 2 ;; \
	esac; \
	mkdir -p $(DEPENDENCIES_DIR); \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-stage; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm "$$apply_service"; \
	$(DEPS_COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-verify

deps-verify:
	$(call compose_run,deps.yml,soldeer-verify)

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

ci: fmt build test fuzz invariant

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
