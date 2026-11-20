import assert from 'node:assert/strict'
import { navigateBrowserDocument, waitForBrowserCondition } from './escrow-browser-fixture.mjs'

// Check the real viewer shell, not a mock appearance component.
export async function checkViewerAppearance({ call, evaluate, viewerURL }) {
  const url = new URL('/', viewerURL).href
  const toggle = '.appearance-switch'
  const key = 'cam-viewer-appearance'
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `appearance: ${expression}`)
  const open = () => navigateBrowserDocument({
    call, url, description: 'the viewer appearance control',
    ready: () => evaluate(`!!document.querySelector('${toggle}')`),
  })
  const state = () => evaluate(`(() => {
    const control = document.querySelector('${toggle}');
    return {
      dark: control.getAttribute('aria-checked') === 'true',
      role: control.getAttribute('role'),
      label: control.getAttribute('aria-label'),
      focusVisible: control.matches(':focus-visible'),
      override: document.documentElement.getAttribute('data-appearance'),
      saved: localStorage.getItem('${key}'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  })()`)
  const changed = async (value, action) => {
    await waitForBrowserCondition(() => evaluate(`document.querySelector('${toggle}').getAttribute('aria-checked')===${JSON.stringify(String(value === 'dark'))}
      && document.documentElement.dataset.appearance===${JSON.stringify(value)}`), `appearance: ${action} selects ${value}`)
  }
  const click = async value => {
    const point = await evaluate(`(() => { const rect = document.querySelector('${toggle}').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await changed(value, 'pointer activation')
  }
  const pressSpace = async value => {
    await evaluate(`document.querySelector('${toggle}').focus()`)
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
    await changed(value, 'Space activation')
  }

  let previousStorage
  const failures = []
  try {
    await call('Emulation.setScriptExecutionDisabled', { value: true })
    try {
      await navigateBrowserDocument({ call, url, description: 'the viewer introduction without JavaScript',
        ready: async () => {
          const { root } = await call('DOM.getDocument', {})
          return (await call('DOM.querySelector', { nodeId: root.nodeId, selector: '.viewer-introduction noscript p' })).nodeId !== 0
        } })
      const { root } = await call('DOM.getDocument', {})
      const { outerHTML } = await call('DOM.getOuterHTML', { nodeId: root.nodeId })
      assert.match(outerHTML, /<h1>CAM Viewer<\/h1>/)
      assert.match(outerHTML, /Contract Application Manifest/)
      assert.match(outerHTML, /manifest names the interface file/)
      assert.match(outerHTML, /CAM contract address/)
      assert.match(outerHTML, /<title>CAM Viewer — Interfaces for Ethereum-compatible apps<\/title>/)
      assert.match(outerHTML, /name="description" content="Open interfaces for apps on Ethereum-compatible networks/)
      for (const path of ['', 'use/', 'gallery/', 'reference/cam/1.4.0/']) {
        assert(outerHTML.includes(`href="https://numpde.github.io/dapp32/${path}"`))
      }
      const app = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '#root' })
      assert.equal((await call('DOM.describeNode', { nodeId: app.nodeId })).node.childNodeCount, 0, 'the explanation does not require React')
      const intro = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '.viewer-introduction' })
      for (const width of [320, 900]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
        const { model } = await call('DOM.getBoxModel', { nodeId: intro.nodeId })
        assert(model.width > 0 && model.height > 0 && model.border[0] >= 0 && model.border[2] <= width, `introduction is visible and fits ${width}px without scripts`)
      }
    } finally {
      await call('Emulation.setScriptExecutionDisabled', { value: false })
      await call('Emulation.clearDeviceMetricsOverride')
    }
    await open()
    assert.equal(await evaluate(`!!document.querySelector('#app-host') && !!document.querySelector('#app-network')`), true, 'interactive setup mounts alongside the introduction')
    assert.equal(await evaluate(`!!document.querySelector('.viewer-heading .appearance-switch') && !document.querySelector('.app-shell .topbar')`), true, 'appearance belongs to the page header without a duplicate setup heading')
    previousStorage = await evaluate(`localStorage.getItem('${key}')`)
    await evaluate(`localStorage.removeItem('${key}')`)
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await open()
    const systemDark = await state()
    assert.equal(systemDark.dark, true)
    assert.equal(systemDark.override, null)
    assert.equal(systemDark.saved, null)
    assert.equal(systemDark.role, 'switch')
    assert.equal(systemDark.label, 'Dark appearance')
    assert.equal(systemDark.scheme, 'light dark')

    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await wait(`document.querySelector('${toggle}').getAttribute('aria-checked')==='false'`)
    const systemLight = await state()
    assert.equal(systemLight.override, null)
    assert.notEqual(systemLight.background, systemDark.background, 'the unstored default follows the OS')
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await wait(`document.querySelector('${toggle}').getAttribute('aria-checked')==='true'`)

    await click('light')
    const manualLight = await state()
    assert.equal(manualLight.saved, 'light')
    assert.equal(manualLight.scheme, 'light')
    assert.notEqual(manualLight.background, systemDark.background)
    await open()
    assert.equal((await state()).dark, false, 'the saved choice survives reload')

    await pressSpace('dark')
    const manualDark = await state()
    assert.equal(manualDark.saved, 'dark')
    assert.equal(manualDark.scheme, 'dark')
    assert.equal(manualDark.background, systemDark.background)
    assert.equal(manualDark.focusVisible, true, 'keyboard activation retains a visible focus ring')

    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    assert.equal((await state()).background, manualDark.background, 'a manual override wins over the system setting')
    await open()
    assert.equal((await state()).dark, true, 'dark preference survives reload')

    for (const width of [320, 900]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
      assert.equal((await state()).overflow, false, `appearance switch fits ${width}px`)
    }
  } catch (error) { failures.push(error) }
  finally {
    if (previousStorage !== undefined) {
      try {
        await evaluate(`(() => {
          const previous = ${JSON.stringify(previousStorage)};
          if (previous === null) localStorage.removeItem('${key}');
          else localStorage.setItem('${key}', previous);
        })()`)
      } catch (error) { failures.push(error) }
    }
    try { await call('Emulation.clearDeviceMetricsOverride') } catch (error) { failures.push(error) }
    try { await call('Emulation.setEmulatedMedia', { features: [] }) } catch (error) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Appearance check and restoration failures')
  return { appearance: 'light/dark switch, implicit OS default, persistence and keyboard', widths: [320, 900] }
}
