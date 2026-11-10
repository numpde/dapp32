import assert from 'node:assert/strict'
import { navigateBrowserDocument, waitForBrowserCondition } from './escrow-browser-fixture.mjs'

// Check the real viewer shell, not a mock appearance component.
export async function checkViewerAppearance({ call, evaluate, viewerURL }) {
  const url = new URL('/', viewerURL).href
  const select = '.appearance-control select'
  const key = 'cam-viewer-appearance'
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `appearance: ${expression}`)
  const open = () => navigateBrowserDocument({
    call, url, description: 'the viewer appearance control',
    ready: () => evaluate(`!!document.querySelector('${select}')`),
  })
  const state = () => evaluate(`(() => {
    const control = document.querySelector('${select}');
    return {
      selection: control.value,
      values: [...control.options].map(option => option.value),
      label: control.labels[0]?.textContent.trim(),
      override: document.documentElement.dataset.appearance ?? null,
      saved: localStorage.getItem('${key}'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
      panel: getComputedStyle(document.querySelector('.app-setup')).backgroundColor,
      input: getComputedStyle(document.querySelector('#app-host')).backgroundColor,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  })()`)
  const choose = async value => {
    await evaluate(`(() => { const select = document.querySelector('${select}'); select.value=${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await wait(`document.querySelector('${select}').value===${JSON.stringify(value)}
      && document.documentElement.dataset.appearance===${value === 'system' ? 'undefined' : JSON.stringify(value)}`)
  }

  let previousStorage
  try {
    await open()
    previousStorage = await evaluate(`localStorage.getItem('${key}')`)
    await evaluate(`localStorage.removeItem('${key}')`)
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await open()
    const systemDark = await state()
    assert.equal(systemDark.selection, 'system')
    assert.equal(systemDark.override, null)
    assert.equal(systemDark.saved, null)
    assert.deepEqual(systemDark.values, ['system', 'light', 'dark'])
    assert.match(systemDark.label, /Appearance/)
    assert.equal(systemDark.scheme, 'light dark')

    await choose('light')
    const manualLight = await state()
    assert.equal(manualLight.saved, 'light')
    assert.equal(manualLight.scheme, 'light')
    assert.notEqual(manualLight.background, systemDark.background)
    assert.notEqual(manualLight.panel, systemDark.panel)
    assert.notEqual(manualLight.input, systemDark.input)
    assert.notEqual(manualLight.foreground, systemDark.foreground)
    await open()
    assert.equal((await state()).selection, 'light', 'the saved choice survives reload')

    await choose('dark')
    const manualDark = await state()
    assert.equal(manualDark.saved, 'dark')
    assert.equal(manualDark.scheme, 'dark')
    assert.equal(manualDark.background, systemDark.background)

    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    assert.equal((await state()).background, manualDark.background, 'a manual override wins over the system setting')
    await open()
    assert.equal((await state()).selection, 'dark', 'dark preference survives reload')

    await choose('system')
    const systemLight = await state()
    assert.equal(systemLight.saved, null)
    assert.equal(systemLight.scheme, 'light dark')
    assert.equal(systemLight.background, manualLight.background)

    for (const width of [320, 900]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
      assert.equal((await state()).overflow, false, `appearance selector fits ${width}px`)
    }
    await call('Emulation.clearDeviceMetricsOverride')
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    assert.equal((await state()).background, systemDark.background, 'system selection tracks OS changes')

    return { appearance: 'system default, explicit overrides and persistence', widths: [320, 900] }
  } finally {
    await evaluate(`(() => { if (${JSON.stringify(previousStorage)} === null) localStorage.removeItem('${key}');
      else if (${JSON.stringify(previousStorage)} !== undefined) localStorage.setItem('${key}', ${JSON.stringify(previousStorage)}); })()`)
    await call('Emulation.clearDeviceMetricsOverride')
    await call('Emulation.setEmulatedMedia', { features: [] })
  }
}
