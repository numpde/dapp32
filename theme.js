// Apply a saved choice before styles render; bind the shared control once parsed.
(() => {
  const key = 'dapp32-theme'
  const system = matchMedia('(prefers-color-scheme: dark)')
  const theme = value => value === 'light' || value === 'dark' ? value : undefined
  let selected
  try { selected = theme(localStorage.getItem(key)) } catch { /* The control still works without storage. */ }
  const effective = () => selected ?? (system.matches ? 'dark' : 'light')
  function apply() {
    if (selected === undefined) document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = selected
  }
  apply()
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme-toggle')
    function update() {
      apply()
      const current = effective()
      const label = `Switch to ${current === 'dark' ? 'light' : 'dark'} mode`
      button.dataset.themeState = current
      button.setAttribute('aria-label', label)
      button.title = label
    }
    button.addEventListener('click', () => {
      selected = effective() === 'dark' ? 'light' : 'dark'
      update()
      try { localStorage.setItem(key, selected) } catch { /* Keep the in-page choice. */ }
    })
    system.addEventListener('change', update)
    update()
    button.hidden = false
  }, { once: true })
})()
