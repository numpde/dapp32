.DEFAULT_GOAL := help
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

SOURCE_REPO ?=
export SOURCE_REPO
PYTHON_IMAGE := docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

.PHONY: help pages/check
help:
	@printf '%s\n' 'make pages/check SOURCE_REPO=/path/to/dapp32' '  Check this site’s local links, fragments and examples against the source repository’s committed HEAD.' '  Uses an offline, read-only Python container; requires Docker and a local source checkout.' 'make pages/networks/check [CDP_ORIGIN=http://127.0.0.1:9222]' '  Open an owned browser tab to check automatic catalog loading and failure feedback.' '  Requires a running CDP browser; fetches the public catalog without visiting RPC endpoints.' 'make pages/deployments/check [LIVE_RPC=1]' '  Check deployment reads, RPC selection and recovery in an owned background browser tab.' '  Uses fixture RPC by default; LIVE_RPC=1 additionally reads the listed public deployment.'

pages/check:
	@: "$${SOURCE_REPO:?Set SOURCE_REPO to the dapp32 source checkout.}"; \
	archive="$$(mktemp -d /tmp/dapp32-pages-source.XXXXXXXX)"; \
	trap 'rm -rf -- "$$archive"' EXIT; \
	git -C "$$SOURCE_REPO" archive HEAD | tar -x -C "$$archive"; \
	chmod 755 "$$archive"; \
	docker run --rm --pull never --network none --read-only --user 65532:65532 \
	  --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 \
	  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
	  --mount "type=bind,src=$$PWD,dst=/site,readonly" \
	  --mount "type=bind,src=$$archive,dst=/source,readonly" \
	  "$(PYTHON_IMAGE)" python3 -I -B /site/check_pages.py --source-archive /source

NODE_IMAGE := docker.io/library/node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
CDP_ORIGIN ?= http://127.0.0.1:9222

.PHONY: pages/networks/check
pages/networks/check:
	docker run --rm --pull never --network host --read-only --user 65532:65532 \
	  --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 \
	  --env CDP_ORIGIN="$(CDP_ORIGIN)" --env PAGE_HTML=/page.html \
	  --mount "type=bind,src=$$PWD/check_networks.mjs,dst=/check.mjs,readonly" \
	  --mount "type=bind,src=$$PWD/deployment/networks/index.html,dst=/page.html,readonly" \
	  "$(NODE_IMAGE)" node /check.mjs

LIVE_RPC ?= 0
.PHONY: pages/deployments/check
pages/deployments/check:
	docker run --rm --pull never --network host --read-only --user 65532:65532 \
	  --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 \
	  --env CDP_ORIGIN="$(CDP_ORIGIN)" --env SITE_ROOT=/site --env LIVE_RPC="$(LIVE_RPC)" \
	  --mount "type=bind,src=$$PWD,dst=/site,readonly" \
	  "$(NODE_IMAGE)" node /site/check_deployments.mjs
