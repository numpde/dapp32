SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE_DIR ?= compose
DOCKER_COMPOSE ?= docker compose
COMPOSE_PROJECT_NAME ?= contracts
LOCAL_UID ?= $(shell id -u)
LOCAL_GID ?= $(shell id -g)

RPC_COMPOSE_PROJECT_NAME ?= $(COMPOSE_PROJECT_NAME)-cast-rpc

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)
RPC_COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(RPC_COMPOSE_PROJECT_NAME)

define compose_run
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --build --rm $(2)
endef

.PHONY: help deps fmt build test fuzz invariant coverage ci cast-offline cast-rpc anvil

help:
	@printf '%s\n' \
	  'Supported lanes:' \
	  '  make deps         Install Soldeer dependencies and update lock/remappings' \
	  '  make fmt          Check Solidity formatting' \
	  '  make build        Compile contracts' \
	  '  make test         Run unit tests' \
	  '  make fuzz         Run fuzz tests' \
	  '  make invariant    Run invariant tests' \
	  '  make coverage     Print coverage summary' \
	  '  make ci           Run fmt, build, unit, fuzz, and invariant lanes' \
	  '  make cast-offline Run offline cast smoke lane' \
	  '  make cast-rpc RPC_URL_FILE=/path  Read a block number through the RPC egress proxy' \
	  '  RPC_URL=https://... make cast-rpc  Same, using a temporary secret file' \
	  '  make anvil        Start local Anvil on 127.0.0.1:$${ANVIL_HOST_PORT:-8545}' \
	  '' \
	  'All lanes are Docker-backed. Default check lanes are offline, read-only,' \
	  'non-root, capability-free, and avoid writing build artifacts into the repo.'

deps:
	@cleanup() { \
	  status="$$?"; \
	  $(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; \
	  exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/deps.yml run --build --rm soldeer-install

fmt:
	$(call compose_run,forge.yml,forge-fmt)

build:
	$(call compose_run,forge.yml,forge-build)

test:
	$(call compose_run,forge.yml,forge-test)

fuzz:
	$(call compose_run,forge.yml,forge-fuzz)

invariant:
	$(call compose_run,forge.yml,forge-invariant)

coverage:
	$(call compose_run,forge.yml,forge-coverage)

ci: fmt build test fuzz invariant

cast-offline:
	$(call compose_run,cast.yml,cast-offline)

cast-rpc:
	@if [[ -n "$${RPC_URL:-}" && -n "$${RPC_URL_FILE:-}" ]]; then \
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

anvil:
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up --build anvil
