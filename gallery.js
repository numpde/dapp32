// The homepage is readable without scripts; these links are enhanced from the
// same immutable deployment records used by the deployments directory.
const cards = [...document.querySelectorAll('[data-gallery-app]')];
const message = document.querySelector('#gallery-status');

function launchURL(base, deployment) {
  const url = new URL(base, location.href);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unexpected viewer URL.');
  if (!Number.isSafeInteger(deployment.chainId) || deployment.chainId <= 0) throw new Error('Invalid deployment chain.');
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployment.host)) throw new Error('Invalid deployment host.');
  url.searchParams.set('chainId', `eip155:${deployment.chainId}`);
  url.searchParams.set('host', deployment.host);
  return url.href;
}

function viewerLink(label, name) {
  const a = document.createElement('a');
  a.textContent = label;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', `${label} — ${name}`);
  return a;
}

async function renderGallery() {
  const response = await fetch('./deployments/deployments.json', {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Deployment catalog unavailable.');
  const data = await response.json();
  const grouped = new Map();
  for (const deployment of data.deployments) {
    if (!grouped.has(deployment.appId)) grouped.set(deployment.appId, []);
    grouped.get(deployment.appId).push(deployment);
  }

  for (const card of cards) {
    const releases = grouped.get(card.dataset.galleryApp);
    if (!releases?.length) continue; // Keep the static, usable directory link.
    const ordered = [...releases].sort((a, b) =>
      (b.deployedAt ?? '').localeCompare(a.deployedAt ?? ''));
    const details = card.querySelector('[data-gallery-details]');
    const actions = card.querySelector('.gallery-links');
    const title = card.querySelector('.app-tile-heading');
    const open = viewerLink('Open app', ordered[0].name);
    const preview = viewerLink('Pages preview', ordered[0].name);

    function select(deployment) {
      const fragment = new URL(`./deployments/#${encodeURIComponent(deployment.id)}`, location.href);
      details.href = fragment.href;
      open.href = launchURL(data.viewer, deployment);
      preview.href = launchURL(data.previewViewer, deployment);
    }

    if (ordered.length > 1) {
      const picker = document.createElement('select');
      picker.setAttribute('aria-label', `${ordered[0].name} deployment`);
      for (const [index, deployment] of ordered.entries()) {
        const option = document.createElement('option');
        option.value = deployment.id;
        option.textContent = `${deployment.deployedAt}${index === 0 ? ' · Latest' : ''}`;
        picker.append(option);
      }
      picker.addEventListener('change', () => {
        const selected = ordered.find(item => item.id === picker.value);
        if (selected) select(selected);
      });
      title.append(picker);
    }
    select(ordered[0]);
    actions.prepend(open, preview);
  }
}

void renderGallery().catch(() => {
  message.hidden = false;
  message.textContent = 'Direct launch links are unavailable. Use the deployment links in the cards.';
});
