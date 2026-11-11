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
  try {
    await open()
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
    return { appearance: 'light/dark switch, implicit OS default, persistence and keyboard', widths: [320, 900] }
  } finally {
    if (previousStorage !== undefined) {
      await evaluate(`(() => {
        const previous = ${JSON.stringify(previousStorage)};
        if (previous === null) localStorage.removeItem('${key}');
        else localStorage.setItem('${key}', previous);
      })()`)
    }
    await call('Emulation.clearDeviceMetricsOverride')
    await call('Emulation.setEmulatedMedia', { features: [] })
  }
}
