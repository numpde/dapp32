"""Audit the two independently published GitHub Pages components.

Each publisher owns one manifest and the files it produces:
* docs-publication.json covers generated documentation; docs_site checks its
  complete file inventory, generated navigation and immutable references.
* viewer/viewer-publication.json covers the standalone Pages viewer bundle;
  viewer_pages checks its index, compiled assets and their exact hashes.
Both manifests are also checked as publicly served files, but cannot contain
their own digest.

This module owns neither artifact and never repairs publication. It checks
three independent facts: the recorded CI run qualified the recorded source,
no newer completed qualification supersedes it, and every recorded file on
gh-pages matches the publicly served bytes. A failed publishing job following
a successful qualification is therefore detectable without rebuilding code.

Workflow_run checks observe only the publisher that completed; the scheduled
and manual checks audit both components. This avoids transient cross-publisher
staleness while the other serialized gh-pages writer is still working.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import time
from typing import Callable
from urllib.parse import quote
from urllib.request import Request, urlopen

from tools import docs_site, viewer_pages


ORIGIN = "https://numpde.github.io/dapp32/"
COMPONENTS = {
    "docs": ("docs-pages-candidate.yml", "qualify",
             "Documentation qualification and automatic publication"),
    "viewer": ("viewer-pages-preview.yml", "candidate",
               "Viewer qualification and automatic Pages publication"),
}


def read_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError(f"Invalid publication manifest: {path}")
    return manifest


def qualified_job(jobs: list[dict], job_name: str) -> bool:
    return any(job.get("name") == job_name and job.get("conclusion") == "success"
               for job in jobs)


def latest_qualified_source(component: str, get_json: Callable[[str], dict],
                            *, completed_only: bool) -> dict:
    """Find the newest successful component qualification on main.

    The auditor excludes in-progress runs to avoid transient drift alarms.
    A publisher includes them: its own qualification has succeeded while its
    publication job is still running. Publication success is not required.
    """
    workflow, job_name, _ = COMPONENTS[component]
    for page in range(1, 6):
        response = get_json(f"actions/workflows/{workflow}/runs?branch=main&per_page=100&page={page}")
        runs = response["workflow_runs"]
        for run in runs:
            if ((completed_only and run.get("status") != "completed")
                    or run.get("event") not in ("push", "workflow_dispatch")
                    or run.get("head_branch") != "main"):
                continue
            jobs = get_json(f"actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
            if qualified_job(jobs, job_name):
                return run
        if len(runs) < 100:
            break
    raise ValueError(f"No successful main qualification found for {component}")


def check_current_qualification(component: str, source_sha: str, run_id: int,
                                get_json: Callable[[str], dict]) -> None:
    """Reject publication when a newer successful qualification supersedes it.

    A later main commit that did not trigger this component's workflow
    does not invalidate its qualified artifact.
    """
    latest = latest_qualified_source(component, get_json, completed_only=False)
    if latest["id"] != run_id or latest["head_sha"] != source_sha:
        raise ValueError(f"{component}: qualification superseded; "
                         f"publishing={source_sha} (run {run_id}), "
                         f"latest={latest['head_sha']} (run {latest['id']})")


def check_freshness(component: str, manifest: dict, repository: str,
                    get_json: Callable[[str], dict]) -> None:
    """Require a real successful component qualification, then reject stale source.

    An unrelated main commit does not create a newer component qualification.
    Failure details name both the published and newest qualified SHA/run.
    """
    _, job_name, workflow_name = COMPONENTS[component]
    run_id = manifest["qualified_run_id"]
    record = get_json(f"actions/runs/{run_id}")
    jobs = get_json(f"actions/runs/{run_id}/jobs?per_page=100")["jobs"]
    if (record.get("name") != workflow_name
            or record["repository"]["full_name"] != repository
            or record.get("head_branch") != "main"
            or record.get("event") not in ("push", "workflow_dispatch")
            or record.get("head_sha") != manifest["source_sha"]
            or not qualified_job(jobs, job_name)):
        raise ValueError(f"{component}: recorded run {run_id} did not qualify source {manifest['source_sha']}")

    latest = latest_qualified_source(component, get_json, completed_only=True)
    if manifest["source_sha"] != latest["head_sha"]:
        raise ValueError(f"{component}: stale publication; "
                         f"published={manifest['source_sha']} (run {run_id}), "
                         f"latest qualified={latest['head_sha']} (run {latest['id']})")


def local_files(component: str, site: Path, docs_source: Path | None) -> tuple[dict, dict[str, str]]:
    """Reuse each publisher's own validation and file manifest."""
    if component == "docs":
        if docs_source is None:
            raise ValueError("Documentation source checkout is required")
        docs_site.check_published(docs_source, site)
        manifest = read_manifest(site / docs_site.MANIFEST)
        files = dict(manifest["files"])
        files[docs_site.MANIFEST] = sha256((site / docs_site.MANIFEST).read_bytes()).hexdigest()
        return manifest, files
    manifest = viewer_pages.check_published(site / "viewer")
    files = {f"viewer/{path}": digest for path, digest in manifest["files"].items()}
    files[f"viewer/{viewer_pages.MANIFEST}"] = sha256(
        (site / "viewer" / viewer_pages.MANIFEST).read_bytes()
    ).hexdigest()
    return manifest, files


def fetch_public_bytes(relative: str, expected_size: int) -> bytes:
    url = ORIGIN + quote(relative, safe="/")
    request = Request(url, headers={"Cache-Control": "no-cache",
                                    "User-Agent": "dapp32-publication-integrity"})
    with urlopen(request, timeout=12) as response:
        payload = response.read(expected_size + 1)
    return payload


def check_served_files(site: Path, files: dict[str, str],
                       fetch: Callable[[str, int], bytes]) -> None:
    """GET every recorded path over HTTPS and compare its exact SHA-256.

    Reads are bounded, concurrent and retried for temporary CDN propagation
    lag. The checker never uses an HTTP 200 response as proof of matching bytes.
    """
    def check_one(item: tuple[str, str]) -> str | None:
        relative, digest = item
        size = (site / relative).stat().st_size
        for attempt in range(3):
            try:
                content = fetch(relative, size)
                if len(content) == size and sha256(content).hexdigest() == digest:
                    return None
                problem = f"different bytes: {relative}"
            except (OSError, ValueError) as error:
                problem = f"unreachable: {relative} ({error})"
            if attempt < 2:
                time.sleep(2)
        return problem

    with ThreadPoolExecutor(max_workers=8) as pool:
        failures = [result for result in pool.map(check_one, files.items()) if result is not None]
    if failures:
        raise ValueError(f"Published site drift ({len(failures)} files): "
                         + "; ".join(failures[:12]))


def github_reader(repository: str, token: str) -> Callable[[str], dict]:
    def get_json(path: str) -> dict:
        request = Request(f"https://api.github.com/repos/{repository}/{path}",
                          headers={"Authorization": f"Bearer {token}",
                                   "Accept": "application/vnd.github+json",
                                   "User-Agent": "dapp32-publication-integrity"})
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    return get_json


def verify(site: Path, docs_source: Path | None, components: tuple[str, ...],
           repository: str, get_json: Callable[[str], dict],
           fetch: Callable[[str, int], bytes]) -> None:
    for component in components:
        manifest, files = local_files(component, site, docs_source)
        check_freshness(component, manifest, repository, get_json)
        check_served_files(site, files, fetch)
        print(f"{component}: {manifest['source_sha']} from qualified run "
              f"{manifest['qualified_run_id']}; {len(files)} local and HTTPS hashes match.")


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "current" and sys.argv[2] in COMPONENTS:
        try:
            repository = os.environ["GITHUB_REPOSITORY"]
            check_current_qualification(
                sys.argv[2], os.environ["GITHUB_SHA"], int(os.environ["GITHUB_RUN_ID"]),
                github_reader(repository, os.environ["GH_TOKEN"]),
            )
        except (OSError, ValueError, KeyError) as error:
            raise SystemExit(f"Pages qualification check failed: {error}") from error
        return
    if len(sys.argv) != 4 or sys.argv[1] not in (*COMPONENTS, "all"):
        raise SystemExit("usage: python -m tools.pages_integrity docs|viewer|all SITE DOCS_SOURCE")
    selected = tuple(COMPONENTS) if sys.argv[1] == "all" else (sys.argv[1],)
    try:
        verify(Path(sys.argv[2]), Path(sys.argv[3]) if "docs" in selected else None,
               selected, os.environ["GITHUB_REPOSITORY"],
               github_reader(os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"]),
               fetch_public_bytes)
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(f"Pages integrity check failed: {error}") from error


if __name__ == "__main__":
    main()
