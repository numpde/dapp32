---
title: "Set up a source checkout"
description: ""
outline: false
---

# Set up a source checkout

<div class="ported-guide">


<p>Use a non-root account with Git, Bash, Make, Docker and Compose. The workflows select a <strong>local Linux Docker engine</strong>; do not substitute a remote context for a server login.</p>
<h2 id="install-the-locked-dependencies">Install the locked dependencies</h2>
<pre><code>git clone https://github.com/numpde/dapp32.git
cd dapp32
docker context ls
make dapps/deps/install DOCKER_CONTEXT=your-local-context
make js/deps/install DOCKER_CONTEXT=your-local-context
make ci DOCKER_CONTEXT=your-local-context</code></pre>
<p>Replace <code>your-local-context</code> with the engine you intend to use. Omit the argument only when you want the interactive chooser. Noninteractive commands need the context on the Make command line. Each operation resolves that engine once and uses the same endpoint for child operations and cleanup.</p>
<p>Dependency installation is explicitly networked. The offline checks do not install missing dependencies for you. For the standalone viewer, only JavaScript dependencies are needed; its <a href="../viewer/deploy.html#build">build guide</a> also acquires its pinned base images explicitly.</p>
<h2 id="choose-the-relevant-validation">Choose the relevant validation</h2>
<table><thead><tr><th>Change</th><th>Validation</th></tr></thead><tbody>
<tr><td>Authored CAM files</td><td><code>make cam/conformance/check</code>; refresh resource pins after edits.</td></tr>
<tr><td>Repository/tooling</td><td><code>make tests/checks</code>; relevant integration tests for changed behavior.</td></tr>
<tr><td>JavaScript/runtime</td><td><code>make js/tests</code> and the affected app scenario.</td></tr>
<tr><td>Complete fixture qualification</td><td><code>make tests</code>, which also runs networked checks and disposable local scenarios.</td></tr>
<tr><td>Documentation changes</td><td><code>python3 -B -m unittest tests.checks.test_docs_port tests.checks.test_docs_build_lifecycle</code>; the docs candidate workflow builds the site and checks generated routes.</td></tr>
</tbody></table>
<p>Add your context to source Make commands. Run <code>make help</code> for prerequisites and current target options. README-only CI uses its lightweight length check, not application integration.</p>
<h2 id="host-prerequisites-and-private-files">Host prerequisites and private files</h2>
<p>Isolated Compose services disable Multipath TCP, so the kernel must expose the per-network-namespace <code>net.mptcp.enabled</code> setting. Host-network browser tools instead share the host's settings.</p>
<p>Release tools also need host Python 3.11+ and the maintained identity probe. Follow <a href="../deployment/#docker-identity">private-file qualification</a> before using an operator instance on a different engine. Do not repair access failures by loosening the instance's permissions or changing its owner.</p>
<h2 id="source-and-documentation-ownership">Source and documentation ownership</h2>
<p><code>main</code> owns implementation, fixtures, Markdown documentation and protocol-reference sources. <code>gh-pages</code> is the reviewed, generated publication output; it also hosts the independently built viewer preview. Documentation edits are qualified by the Docs Pages candidate workflow. To publish, manually run Publish qualified documentation on main with a successful main-branch qualification run ID; publication reuses that exact artifact without rebuilding. The viewer has its own pipeline. Each publisher permits one outstanding review candidate branch: merge or retire it before proposing another. Reuse one source work branch for related commits and delete it after merge. Keep versioned CAM protocol copies byte-identical to their source; current readers use CAM 1.4.0 / UI 1.1.0. Historical specifications are not compatibility promises.</p>
<p>For a release or published example, record the reviewed source commit. Do not mix an older deployment's ABI and signing rules with today's guide. The <a href="https://github.com/numpde/dapp32/tree/archive/poc-2026-05-20">archived proof of concept</a> is historical, not the starting point for current work.</p>

</div>
