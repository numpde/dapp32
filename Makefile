.DEFAULT_GOAL := help
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

SOURCE_REPO ?=
export SOURCE_REPO
PYTHON_IMAGE := docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

.PHONY: help pages/check
help:
	@printf '%s\n' 'make pages/check SOURCE_REPO=/path/to/dapp32' '  Check this site’s local links, fragments and examples against the source repository’s committed HEAD.' '  Uses an offline, read-only Python container; requires Docker and a local source checkout.'

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
