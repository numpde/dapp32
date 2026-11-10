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
<div class="table-scroll" role="region" aria-label="Table: Change / Validation" tabindex="0">
<table><thead><tr><th>Change</th><th>Validation</th></tr></thead><tbody>
<tr><td>Authored CAM files</td><td><code>make cam/conformance/check</code>; refresh resource pins after edits.</td></tr>
<tr><td>Repository/tooling</td><td><code>make tests/checks</code>; relevant integration tests for changed behavior.</td></tr>
<tr><td>JavaScript/runtime</td><td><code>make js/tests</code> and the affected app scenario.</td></tr>
<tr><td>Complete fixture qualification</td><td><code>make tests</code>, which also runs networked checks and disposable local scenarios.</td></tr>
<tr><td>Documentation changes</td><td><code>python3 -B -m unittest discover -v -s tests/checks -t . -p 'test_docs_*.py'</code>; the docs candidate workflow builds the site and checks generated routes.</td></tr>
</tbody></table>
</div>
<p>Add your context to source Make commands. Run <code>make help</code> for prerequisites and current target options. README-only CI uses its lightweight length check, not application integration.</p>
<h2 id="host-prerequisites-and-private-files">Host prerequisites and private files</h2>
<p>Isolated Compose services disable Multipath TCP, so the kernel must expose the per-network-namespace <code>net.mptcp.enabled</code> setting. Host-network browser tools instead share the host's settings.</p>
<p>Release tools also need host Python 3.11+ and the maintained identity probe. Follow <a href="../deployment/#docker-identity">private-file qualification</a> before using an operator instance on a different engine. Do not repair access failures by loosening the instance's permissions or changing its owner.</p>
<h2 id="navigation-ownership">Documentation navigation ownership</h2>
<p><code>docs/.vitepress/architecture.json</code> declares the site homepage as the root and assigns every authored guide exactly one canonical route. The sections are its children, not competing top-level tabs. The homepage cards and its left sidebar are both rendered from those sections' labels and landing routes, so neither can drift from the top navigation. Every canonical documentation page, including the site root, must render a sidebar; CI checks the generated HTML against its declared owner. Every section declares a landing page separately from its sidebar groups: <code>pages</code> groups link only to guides owned by that section; the Gallery's <code>catalog</code> group reads app names and anchors from <code>docs/public/gallery/deployments.json</code>. The same inventory generates top navigation, sidebars, breadcrumbs and legacy redirects. Do not add sidebar links directly to the VitePress config or duplicate deployment names in navigation. Put links to another section in the page's <strong>Related tasks</strong> content, as on the <a href="../gallery/">Gallery</a> page.</p>
<p>Docs CI checks unique route ownership, in-section sidebar destinations, valid catalog anchors and the rendered sidebar of every generated guide. Add or move pages by editing the inventory and the source page; broken navigation fails publication.</p>
<h2 id="source-and-documentation-ownership">Source and documentation ownership</h2>
<p><code>main</code> owns implementation, fixtures, Markdown documentation and protocol-reference sources. <code>gh-pages</code> holds generated published documentation and the independently built Pages viewer. Both publishers build and qualify on <code>main</code>, reuse their exact qualified artifact, and publish automatically; neither needs a manual publishing PR. Documentation owns the site outside the viewer application files; the viewer owns <code>viewer/index.html</code>, <code>viewer/assets/</code> and its publication manifest. Both use the same CI publication lock on <code>gh-pages</code>, preserve the other's files and refuse non-fast-forward updates. The independently hosted viewer is deployed separately. Keep versioned CAM protocol copies byte-identical to their source; current readers use CAM 1.4.0 / UI 1.1.0. Historical specifications are not compatibility promises.</p>
<h2 id="published-site-integrity">Published-site integrity and drift</h2>
<p><code>gh-pages</code> is a deployment snapshot, <strong>not</strong> a Git-history mirror of <code>main</code>. For each component, the publication manifest identifies the exact <code>source_sha</code>, <code>qualified_run_id</code>, and SHA-256 digest of every generated file it owns. Documentation records these in <code>docs-publication.json</code> at the site root; the viewer records its HTML and hashed assets in <code>viewer/viewer-publication.json</code>. The viewer's hosting guide is documentation-owned and is not included in the viewer manifest. Neither publisher maintains a second file inventory by hand.</p>
<p><a href="https://github.com/numpde/dapp32/actions/workflows/pages-integrity.yml">Published Pages integrity</a> is the independent, read-only audit. It runs when either publisher finishes (checking that component), daily at 07:17 UTC (checking both), and on manual dispatch. Pull requests run its unit tests without publishing. The auditor checks that the recorded CI run actually qualified its recorded source, compares that source with the <em>newest completed successful qualification for that component</em>, checks the complete local file inventory against its recorded hashes, and fetches every owned file over public HTTPS to compare exact bytes. A newer unrelated <code>main</code> commit does not constitute drift; a newer qualification whose publication failed does. A currently running qualification is not considered final until its workflow completes.</p>
<p>A failing audit names the affected component and the source revisions or files that disagree. Check the <a href="https://github.com/numpde/dapp32/actions/workflows/docs-pages-candidate.yml">documentation publisher</a> or <a href="https://github.com/numpde/dapp32/actions/workflows/viewer-pages-preview.yml">viewer publisher</a> for its qualifying and publishing jobs. Inspect the manifest, <code>gh-pages</code> checkout and served response separately: an accurate manifest does not prove publication reached the CDN, and a successful Git push does not prove the intended bytes were deployed. Resolve the underlying failed qualification, publishing or CDN boundary, then re-run the appropriate publisher from <code>main</code>. The audit never repairs drift or changes either branch. Do not merge or rebase <code>main</code> into <code>gh-pages</code> to force synchronization.</p>
<p>For a release or published example, record the reviewed source commit. Do not mix an older deployment's ABI and signing rules with today's guide. The <a href="https://github.com/numpde/dapp32/tree/archive/poc-2026-05-20">archived proof of concept</a> is historical, not the starting point for current work.</p>

</div>
