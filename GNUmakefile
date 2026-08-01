# GNU Make loads this file before Makefile. Keep the repository-wide lanes in
# Makefile; this thin layer adds an explicit source-mutating developer action.
include Makefile

.PHONY: format

# Normalize one first-level dapp with the repository-pinned Foundry image.
# The ordinary `make fmt` lane remains a read-only check over every dapp.
format:
	@$(LANE_GUARD); \
	if [[ -z "$${DAPP:-}" ]]; then \
	  printf '%s\n' 'Set DAPP to a first-level dapp directory, for example: make format DAPP=escrow' >&2; \
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
	if [[ ! -d "$$dapp_dir/src" && ! -d "$$dapp_dir/test" && ! -d "$$dapp_dir/script" ]]; then \
	  printf 'DAPP has no Solidity src, test, or script directory: %s\n' "$$DAPP" >&2; \
	  exit 2; \
	fi; \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f $(COMPOSE_DIR)/forge.yml run --build --rm \
	  --env "DAPP=$$DAPP" \
	  --volume "$(abspath $(DAPPS_DIR))/$$DAPP:/work/dapps/$$DAPP:rw" \
	  forge-fmt \
	  sh -eu -c 'set --; for dir in "$$DAPP/src" "$$DAPP/test" "$$DAPP/script"; do if [ -d "$$dir" ]; then set -- "$$@" "$$dir"; fi; done; forge fmt "$$@"'
