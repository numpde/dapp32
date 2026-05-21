SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE_DIR ?= compose
DOCKER_COMPOSE ?= docker compose
COMPOSE_PROJECT_NAME ?= contracts
LOCAL_UID ?= $(shell id -u)
LOCAL_GID ?= $(shell id -g)

COMPOSE_ENV := LOCAL_UID=$(LOCAL_UID) LOCAL_GID=$(LOCAL_GID) COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME)

define compose_run
$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/$(1) run --rm $(2)
endef

.PHONY: help fmt build test fuzz invariant coverage ci cast-offline cast-rpc anvil

help:
	@printf '%s\n' \
	  'Supported lanes:' \
	  '  make fmt          Check Solidity formatting' \
	  '  make build        Compile contracts' \
	  '  make test         Run unit tests' \
	  '  make fuzz         Run fuzz tests' \
	  '  make invariant    Run invariant tests' \
	  '  make coverage     Print coverage summary' \
	  '  make ci           Run fmt, build, unit, fuzz, and invariant lanes' \
	  '  make cast-offline Run offline cast help lane' \
	  '  make cast-rpc RPC_URL=...  Read a block number from an explicit RPC URL' \
	  '  make anvil        Start local Anvil on 127.0.0.1:$${ANVIL_HOST_PORT:-8545}' \
	  '' \
	  'All lanes are Docker-backed. Default check lanes are offline, read-only,' \
	  'non-root, capability-free, and avoid writing build artifacts into the repo.'

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
	RPC_URL="$(RPC_URL)" $(call compose_run,cast.yml,cast-rpc)

anvil:
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/anvil.yml up anvil
