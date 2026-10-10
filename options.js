const box = document.getElementById('niches')
const status = document.getElementById('status')

chrome.storage.local.get({ niches: [] }).then(s => box.value = s.niches.join('\n'))

box.addEventListener('input', () => {
  const niches = box.value.split('\n').map(l => l.trim().replace(/.*\/niches\//, '').replace(/[/?#].*/, '')).filter(Boolean)
  chrome.storage.local.set({ niches })
  status.textContent = niches.length ? `Saved: ${niches.length} niche${niches.length > 1 ? 's' : ''}` : 'Saved: scrolling the current feed'
})

const seekbar = document.getElementById('seekbar')
chrome.storage.local.get({ seekbar: true }).then(s => seekbar.checked = s.seekbar)
seekbar.addEventListener('change', () => chrome.storage.local.set({ seekbar: seekbar.checked }))

const adult = document.getElementById('adult')
const show = () => document.getElementById('adult-settings').hidden = !adult.checked
chrome.storage.local.get({ adult: false }).then(s => {
  adult.checked = s.adult
  show()
})
// RedGifs access is optional and only requested here, so installing the extension doesn't ask for it.
const redgifs = { id: 'redgifs', matches: ['*://*.redgifs.com/*'], js: ['content.js'], runAt: 'document_idle' }
adult.addEventListener('change', async () => {
  if (adult.checked && !await chrome.permissions.request({ origins: redgifs.matches })) adult.checked = false
  // Registering an id twice throws.
  await chrome.scripting.unregisterContentScripts({ ids: [redgifs.id] }).catch(() => {})
  if (adult.checked) await chrome.scripting.registerContentScripts([redgifs])
  else await chrome.permissions.remove({ origins: redgifs.matches })
  chrome.storage.local.set({ adult: adult.checked })
  show()
})
