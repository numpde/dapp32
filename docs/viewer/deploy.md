---
title: "Deploy the stand-alone viewer"
description: "Build the generic viewer, run it on a Linux server and expose it through HTTPS without deploying contracts."
outline: false
---

# Deploy the stand-alone viewer

<div class="ported-guide">


<p>Two hosted versions are available: <a href="https://app.dapp32.com/">the stand-alone viewer</a>, deployed independently, and the <a href="./">Pages preview</a>, built from recent reviewed source and updated ahead of the stand-alone release. The preview is for early testing and may change sooner; inspect all contract details before authorizing transactions. Each origin requires its own wallet permission and browser-accessible RPC/resources.</p>
<p>The Pages preview is published automatically from qualified <code>main</code> builds. CI records its source revision, qualification run and exact built file hashes, then independently checks the published and HTTPS-served bytes. See <a href="../development/#published-site-integrity">Published-site integrity and drift</a>. Those checks cover the Pages preview only; they do not deploy or monitor your independently hosted viewer.</p>
<p>Serve the generic browser application at your own HTTPS hostname. This hosts <strong>viewer software only</strong>: no blockchain, CAM bundle, contract deployment, wallet or private instance directory is created.</p>
<dl><dt>Run on</dt><dd>The Linux server, as its non-root Docker operator. Use that server's local Docker context, not a remote workstation context.</dd><dt>Requires</dt><dd>Git, Make, Bash, Python 3, Docker with Compose and Buildx; the kernel setting <code>net.mptcp.enabled</code>; a hostname you control; host-side Caddy for the HTTPS example.</dd><dt>Changes</dt><dd>A local image, a viewer container/network and the hostname's proxy configuration.</dd><dt>Success</dt><dd>The HTTPS health endpoint responds, the viewer setup page loads, and a known compatible app opens through a browser-readable RPC.</dd></dl>
<nav aria-label="Guide sections"><a href="#build">Build</a> · <a href="#run">Run</a> · <a href="#https">HTTPS</a> · <a href="#open">Open an app</a> · <a href="#maintain">Update or stop</a> · <a href="#automatic-updates">Automatic updates</a> · <a href="#troubleshoot">Troubleshoot</a></nav>
<h2 id="build">1. Build a known source revision</h2>
<p>Clone the repository on the server and check out the reviewed commit you intend to serve. Use a clean checkout so the revision identifies its actual content. In that checkout, set the context and acquire the exact base images named by its Dockerfiles:</p>
<pre><code>CTX=your-local-context &amp;&amp;
test "$(git rev-parse --show-toplevel)" = "$PWD" &amp;&amp;
test -z "$(git status --porcelain)" &amp;&amp;
make base-images/pull DOCKER_CONTEXT="$CTX" \
  DOCKERFILES="containers/node-deps/Dockerfile containers/https-egress-proxy/Dockerfile containers/viewer/Dockerfile" &amp;&amp;
make js/deps/install DOCKER_CONTEXT="$CTX" &amp;&amp;
REV=$(git rev-parse --short=12 HEAD) &amp;&amp;
IMAGE="cam-viewer:$REV" &amp;&amp;
make viewer/image/build DOCKER_CONTEXT="$CTX" VIEWER_IMAGE="$IMAGE"</code></pre>
<p>Replace <code>your-local-context</code> with a local entry from <code>docker context ls</code>. Image acquisition and locked dependency installation are the networked preparation steps. The viewer builder then runs offline. It does not publish the image or install missing dependencies implicitly. Solidity dependencies are not needed just to build the viewer.</p>
<p><code>base-images/pull</code> requires host Python 3 (standard library only) and Docker Buildx. Without <code>DOCKERFILES</code>, it discovers all Dockerfiles under <code>containers/</code>. Docker's native <code>--call=targets,format=json</code> parser identifies the stages without running build instructions; BuildKit may acquire a declared syntax frontend during discovery. The command checks all returned bases for literal digest pins before pulling each distinct external image once. Earlier stages and <code>scratch</code> need no pull; unresolved variables and explicit stage platforms are rejected. Package downloads remain separate.</p>
<p>Downloaded bases stay in the selected Docker engine's cache. Other builds can use the same images, so acquisition does not delete images or containers. Resource cleanup belongs to the command that owns those resources.</p>
<h2 id="run">2. Start it on loopback</h2>
<p>Continue in the same shell. Record the resulting image ID for updates and rollback, then start the existing runtime:</p>
<pre v-pre><code>docker --context "$CTX" image inspect "$IMAGE" --format '{{.Id}}' &amp;&amp;
make viewer/up DOCKER_CONTEXT="$CTX" \
  VIEWER_IMAGE="$IMAGE" VIEWER_COMPOSE_PROJECT_NAME=cam-viewer \
  VIEWER_BIND_HOST=127.0.0.1 VIEWER_PORT=8080 &amp;&amp;
curl --fail --show-error http://127.0.0.1:8080/healthz &amp;&amp;
make viewer/status DOCKER_CONTEXT="$CTX" VIEWER_IMAGE="$IMAGE" VIEWER_COMPOSE_PROJECT_NAME=cam-viewer</code></pre>
<p>The service runs in the background with <code>restart: unless-stopped</code>, a read-only filesystem, resource limits and its own health check. Ensure the selected Docker engine starts at server boot too; for a rootless engine this is an operator service configuration, not something the Compose restart policy establishes.</p>
<p>Only loopback port 8080 is exposed by this recipe. <code>viewer/up</code> neither builds nor pulls an image. Do not prune the previous working image while testing a replacement.</p>
<h2 id="https">3. Put the hostname in front of it</h2>
<p>This example assumes Caddy is installed as a host systemd service, not in another container. Follow its <a href="https://caddyserver.com/docs/install">official installation instructions</a> for your distribution. Point your hostname's A/AAAA records at this server and allow inbound TCP 80 and 443 to Caddy. Keep 8080 private.</p>
<p>Add this site block to <code>/etc/caddy/Caddyfile</code>, replacing the example hostname. Preserve any existing sites in that file:</p>
<pre><code>viewer.example.org {
    reverse_proxy 127.0.0.1:8080
}</code></pre>
<pre><code>sudo caddy validate --config /etc/caddy/Caddyfile &amp;&amp;
sudo systemctl enable --now caddy &amp;&amp;
sudo systemctl reload caddy &amp;&amp;
curl --fail --show-error https://viewer.example.org/healthz</code></pre>
<p>Replace the hostname in the last command too. Caddy obtains and renews a public certificate when its DNS, port and persistent-storage requirements are met. The repository does not manage Caddy or DNS. See the upstream <a href="https://caddyserver.com/docs/quick-starts/reverse-proxy">reverse-proxy recipe</a>, <a href="https://caddyserver.com/docs/automatic-https">HTTPS prerequisites</a> and <a href="https://caddyserver.com/docs/running#using-the-service">service management</a>.</p>
<h2 id="open">4. Open a real application</h2>
<p>Visit your HTTPS hostname in your local browser. In <strong>Open a contract app</strong>, choose the network, enter the trusted <strong>CAM host</strong> address, and select a browser-accessible RPC. The viewing address is optional for a public view; connect a signing wallet separately when needed.</p>
<p>The host discovers the CAM bundle and bound business contracts. The viewer server does not proxy these resource or RPC requests by default: your browser must be able to reach them through HTTPS and the necessary CORS policy. Never place a private signing RPC credential or key in a shared link.</p>
<p>Verify the chain, host, loaded resources and a known read. A healthy web container proves only that the viewer is served; it does not prove an app is authentic, compatible, funded or ready for transactions. Investigate integrity warnings before signing.</p>
<h2 id="maintain">Update, roll back and stop</h2>
<p>Build the new reviewed revision under a new image tag using step 1. Repeat <code>viewer/up</code> with that new <code>VIEWER_IMAGE</code> and the same project, bind address and port. Check health and reopen the app. A container replacement may briefly interrupt service; this is not a zero-downtime deployment procedure.</p>
<p>To roll back, repeat that same startup command with the retained previous image tag or image ID. A viewer rollback does not roll back contracts, CAM publication or transactions. In a new shell, set <code>CTX</code> and the chosen <code>IMAGE</code> again before using these commands.</p>
<pre><code>make viewer/down DOCKER_CONTEXT="$CTX" VIEWER_IMAGE="$IMAGE" VIEWER_COMPOSE_PROJECT_NAME=cam-viewer</code></pre>
<p>Stopping removes this viewer's runtime, not its images or on-chain state. Remove its Caddy site block and reload Caddy when retiring the hostname; do not stop a shared proxy serving other sites.</p>
<h2 id="automatic-updates">Automatic updates from a deployment branch</h2>
<p><code>make viewer/update</code> performs one foreground attempt against <code>origin/deploy/viewer</code>. Publish changes to <code>main</code> first, then advance <code>deploy/viewer</code> to a commit already contained in <code>main</code>. Advancing that branch authorizes a release. The updater fetches both branches and refuses a deployment commit outside <code>main</code> before changing the checkout or runtime. It requires host Python 3 (standard library only), <code>flock</code>, <code>timeout</code>, an existing viewer built with viewer-owned revision labels, a clean deployment checkout and the same Docker context/project/bind settings as the running service. It builds on the server using the acquisition, locked dependency and offline image-build commands above.</p>
<pre><code>make viewer/update DOCKER_CONTEXT=your-local-context \
  VIEWER_COMPOSE_PROJECT_NAME=cam-viewer \
  VIEWER_BIND_HOST=127.0.0.1 VIEWER_PORT=8080 \
  VIEWER_PUBLIC_ORIGIN=https://viewer.example.org</code></pre>
<p>The target fetches the branch, selects its exact commit and compares it with the running container's immutable image and labels. Historical source without the updater is rejected before checkout, preserving the controller when selecting such releases. A healthy matching release needs no build. The checkout follows the selected commit even on that path. A replacement must reach container health and expose its full source revision in the public entry bundle. This observes the served revision; it does not prove publication integrity of every asset.</p>
<p>There are no deployment receipts, SHA files, settings snapshots or release directories. Docker tags <code>cam-viewer-&lt;project&gt;:current</code> and <code>:rollback</code> retain the current and previous working images. An empty lock under <code>$XDG_RUNTIME_DIR</code> serializes attempts; it is runtime synchronization, not deployment history. Temporary build inputs are removed by their creating commands. Compose retires generated dependency/compiler images; the updater removes obsolete images in its own namespace with matching viewer/project/source labels, preserving container references and other tags. Shared upstream bases remain cached.</p>
<p>Dependency or build failure leaves the service unchanged. Activation or public-revision failure attempts rollback and still returns failure. Unconfirmed rollback preserves recovery images. Cleanup failure reports failure without rolling back an accepted healthy release. Abrupt host failure or an uncatchable kill can require manual recovery.</p>
<p>Automatic updates refuse changes to <code>compose/viewer.yml</code> or the existing bind/port settings: migrate the runtime explicitly with <code>viewer/up</code>. A retained rollback used to recover an unhealthy viewer must also have clean viewer-owned identity and a compatible runtime model. Historical images with inherited nginx revision labels require an initial manual build/up migration; they are not admitted as automatically identified viewer releases.</p>
<p>The checked-in <code>tools/systemd/cam-viewer-update.service</code> and <code>.timer</code> are examples. Configure the service's working directory, Docker context, project, bind address, port and public origin in the host-local copy before installing it. Keep host account names, private listeners and full operator paths out of the repository. Preserve existing checkouts and installed production settings when updating the example. After one successful manual attempt, install the configured units into <code>~/.config/systemd/user/</code>, run <code>systemctl --user daemon-reload</code> and <code>systemctl --user enable --now cam-viewer-update.timer</code>. User lingering and the Docker user service must be enabled for operation after logout and reboot.</p>
<p>The timer runs one minute after completion; overlapping manual attempts fail the same lock. The complete attempt has a twenty-minute deadline with bounded cancellation/recovery grace. View status with <code>systemctl --user status cam-viewer-update.timer cam-viewer-update.service</code> and logs with <code>journalctl --user -u cam-viewer-update.service -n 100 --no-pager</code>. A failed attempt retries at the next timer activation. Stop the timer before manual rollback, otherwise the next attempt will reapply the branch. Use <code>viewer/up</code> with the retained <code>:rollback</code> image and the same runtime settings; restart the timer after correcting or moving the branch.</p>
<p>On a dedicated builder, configure an appropriately small native <a href="https://docs.docker.com/build/cache/garbage-collection/">BuildKit garbage-collection budget</a>. The updater does not change shared engine policy or run engine-wide prune. Container logs are already rotated by the runtime; bound journal storage through the host's existing journal configuration.</p>
<h2 id="troubleshoot">Check the failing boundary</h2>
<div class="table-scroll" role="region" aria-label="Table: Symptom / Next check" tabindex="0">
<table><thead><tr><th>Symptom</th><th>Next check</th></tr></thead><tbody>
<tr><td>Required local base image missing</td><td>Repeat explicit acquisition for the Dockerfiles at your selected revision and context.</td></tr>
<tr><td>Container fails before health</td><td>Check the image exists on that engine, port ownership, and the kernel's per-namespace MPTCP setting. Do not remove confinement to hide the failure.</td></tr>
<tr><td>Loopback health works; HTTPS fails</td><td>Check DNS, firewall, Caddy configuration and <code>journalctl -u caddy</code>.</td></tr>
<tr><td>Viewer loads; app does not</td><td>Check browser console/network errors, chain/host coordinates, browser RPC access, resource CORS and Download scope.</td></tr>
</tbody></table>
</div>
<p>Implementation baseline: <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/tools/viewer_image_build.sh">image builder</a>, <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/compose/viewer.yml">portable runtime</a> and the <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/Makefile">viewer Make targets</a>. Hosting CAM resources and deploying contracts are <a href="../deployment/">separate tasks</a>.</p>

</div>
