# Explicit operator entrypoint, run from the repository root:
#   make -f tools/pay-to-play-refunds.mk help
# Reuse the main Makefile's identity, source and dependency guards. Live refund
# execution is intentionally not part of make tests/ci or any local demo.
include Makefile

export REFUND_CONFIG_FILE RPC_URL_FILE REFUND_PRIVATE_KEY_FILE REFUND_STATE_DIR
.PHONY: pay-to-play/local/recovery/run pay-to-play/refunds/help pay-to-play/refunds/check pay-to-play/refunds/plan pay-to-play/refunds/run
help: pay-to-play/refunds/help
pay-to-play/refunds/help:
	@printf '%s\n' \
	  '  pay-to-play/local/recovery/run  Disposable CAM recovery and refund-batch scenario' \
	  '  pay-to-play/refunds/check  Offline typecheck and refund-worker tests' \
	  '  pay-to-play/refunds/plan   Bounded read-only plan; REFUND_CONFIG_FILE and RPC_URL_FILE required' \
	  '  pay-to-play/refunds/run    Execute bounded refunds; also requires REFUND_PRIVATE_KEY_FILE,' \
	  '                            REFUND_STATE_DIR and CONFIRM_PAY_TO_PLAY_REFUNDS=YES' \
	  '  Use: make -f tools/pay-to-play-refunds.mk <target>'

pay-to-play/refunds/check:
	@$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); \
	$(COMPOSE_ENV) $(DOCKER_COMPOSE) -f compose/pay-to-play/refunds/check.yml run --build --rm --no-deps -T pay-to-play-refunds-check

define refund_input_guards
$(LANE_GUARD); $(PACKAGE_DEPS_GUARD); \
$(release_host_guard_functions); \
require_protected_release_file "$${REFUND_CONFIG_FILE:?Set REFUND_CONFIG_FILE}" REFUND_CONFIG_FILE REFUND_CONFIG_FILE; \
require_protected_release_file "$${RPC_URL_FILE:?Set RPC_URL_FILE}" RPC_URL_FILE RPC_URL_FILE
endef

pay-to-play/refunds/plan:
	@$(refund_input_guards); \
	$(COMPOSE_ENV) env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) -f compose/pay-to-play/refunds/run.yml run --build --rm --no-deps -T pay-to-play-refunds

pay-to-play/refunds/run:
	@$(refund_input_guards); \
	if [[ "$${CONFIRM_PAY_TO_PLAY_REFUNDS:?Set CONFIRM_PAY_TO_PLAY_REFUNDS=YES}" != YES ]]; then printf '%s\n' 'Set CONFIRM_PAY_TO_PLAY_REFUNDS=YES after reviewing deployment pins, scope and the gas budget.' >&2; exit 2; fi; \
	require_protected_release_file "$${REFUND_PRIVATE_KEY_FILE:?Set REFUND_PRIVATE_KEY_FILE}" REFUND_PRIVATE_KEY_FILE REFUND_PRIVATE_KEY_FILE; \
	state="$${REFUND_STATE_DIR:?Set REFUND_STATE_DIR}"; \
	if [[ "$$state" != /* || "$$(realpath -m -- "$$state")" != "$$state" ]]; then printf '%s\n' 'REFUND_STATE_DIR must be a normalized absolute path.' >&2; exit 2; fi; \
	reject_release_path_symlinks "$$state" REFUND_STATE_DIR; \
	if [[ ! -d "$$state" || "$$(stat -c %a -- "$$state")" != 700 || "$$(stat -c %u -- "$$state")" != "$(LOCAL_UID)" ]]; then printf '%s\n' 'Pre-create REFUND_STATE_DIR owned by LOCAL_UID with mode 0700.' >&2; exit 2; fi; \
	case "$$state" in "$$(pwd -P)"|"$$(pwd -P)"/*) printf '%s\n' 'REFUND_STATE_DIR must be outside the repository.' >&2; exit 2 ;; esac; \
	$(COMPOSE_ENV) env -u PRIVATE_KEY -u RPC_URL $(DOCKER_COMPOSE) -f compose/pay-to-play/refunds/run.yml -f compose/pay-to-play/refunds/execute.yml run --build --rm --no-deps -T pay-to-play-refunds

# Reuse the maintained fixture lifecycle and its existing account grants. The
# overlay replaces only the scenario command; no live RPC or signing key mounts.
RECOVERY_SCENARIO_COMPOSE_FILES := $(PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES) -f $(COMPOSE_DIR)/pay-to-play/local/recovery-scenario.yml
pay-to-play/local/recovery/run:
	@$(MAKE) pay-to-play/local/scenario/run PAY_TO_PLAY_LOCAL_SCENARIO_COMPOSE_FILES="$(RECOVERY_SCENARIO_COMPOSE_FILES)"
