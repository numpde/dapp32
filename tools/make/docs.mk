# Internal documentation-only Make recipe. Public target remains in root Makefile.
# Keep this implementation separate so content/build changes do not activate
# unrelated Solidity, RPC and viewer workflows.
define docs_build_impl
@$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); \
: "$${DOCS_OUTPUT_DIR:?Set DOCS_OUTPUT_DIR to an existing absolute output directory}"; \
if [[ "$$DOCS_OUTPUT_DIR" != /* || ! -d "$$DOCS_OUTPUT_DIR" || -L "$$DOCS_OUTPUT_DIR" || -e "$$DOCS_OUTPUT_DIR/site" || -L "$$DOCS_OUTPUT_DIR/site" ]]; then \
  printf '%s\n' 'DOCS_OUTPUT_DIR must be an existing absolute directory without a site entry.' >&2; \
  exit 2; \
fi; \
$(select_host_output_identity); \
run_dir="$$(mktemp -d -t dapp32-docs-XXXXXXXX)"; \
run_digest="$$(printf '%s' "$$run_dir" | sha256sum)"; \
run_project="$(COMPOSE_PROJECT_NAME)-docs-$${run_digest:0:24}"; \
export DOCS_IMAGE_TAG="$${run_digest:0:24}"; \
stage_dir=""; \
compose_attempted=0; \
published=0; \
cleanup() { \
  status="$$?"; \
  trap - EXIT; \
  trap '' INT TERM HUP; \
  if [[ "$$compose_attempted" == 1 ]]; then \
    if ! release_with_mapped_owner $(call disposable_cleanup_command,$$run_project,-f $(COMPOSE_DIR)/docs.yml,--rmi all); then \
      printf 'Docs project/volume cleanup failed: %s\n' "$$run_project" >&2; \
      if [[ "$$status" == 0 ]]; then status=1; fi; \
    fi; \
  fi; \
  if [[ -n "$$stage_dir" ]]; then \
    rm -rf -- "$$stage_dir" || { \
      if [[ "$$status" == 0 ]]; then status=1; fi; \
    }; \
  fi; \
  rm -rf -- "$$run_dir" || { \
    if [[ "$$status" == 0 ]]; then status=1; fi; \
  }; \
  if [[ "$$status" == 0 && "$$published" == 1 ]]; then \
    printf 'Generated docs: %s/site\n' "$$DOCS_OUTPUT_DIR"; \
  fi; \
  exit "$$status"; \
}; \
trap cleanup EXIT; \
trap 'exit 130' INT; \
trap 'exit 143' TERM; \
trap 'exit 129' HUP; \
stage_dir="$$(mktemp -d -- "$$DOCS_OUTPUT_DIR/.dapp32-docs-XXXXXXXX")"; \
export DOCS_STAGE_DIR="$$stage_dir"; \
compose_attempted=1; \
release_with_mapped_owner $(DOCKER_COMPOSE) -p "$$run_project" -f $(COMPOSE_DIR)/docs.yml build docs-build; \
release_with_mapped_owner $(DOCKER_COMPOSE) -p "$$run_project" -f $(COMPOSE_DIR)/docs.yml up --no-build --no-deps -d --wait --wait-timeout 20 docs-hold; \
release_with_mapped_owner $(DOCKER_COMPOSE) -p "$$run_project" -f $(COMPOSE_DIR)/docs.yml run --rm --no-deps -T docs-build; \
release_with_mapped_owner $(DOCKER_COMPOSE) -p "$$run_project" -f $(COMPOSE_DIR)/docs.yml run --rm --no-deps -T docs-export; \
if [[ ! -d "$$stage_dir/site" || -L "$$stage_dir/site" || ! -f "$$stage_dir/site/index.html" || -L "$$stage_dir/site/index.html" ]]; then \
  printf '%s\n' 'Docs exporter did not produce a regular site with an index.' >&2; \
  exit 1; \
fi; \
mv -Tn -- "$$stage_dir/site" "$$DOCS_OUTPUT_DIR/site"; \
if [[ -e "$$stage_dir/site" || -L "$$stage_dir/site" || ! -f "$$DOCS_OUTPUT_DIR/site/index.html" || -L "$$DOCS_OUTPUT_DIR/site" ]]; then \
  printf '%s\n' 'Docs publication refused an existing output or failed to move the site.' >&2; \
  exit 1; \
fi; \
published=1
endef
