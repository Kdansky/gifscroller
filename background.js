// Clicking the toolbar icon toggles auto-advance; the badge shows OFF while disabled.
const paint = on => chrome.action.setBadgeText({ text: on ? '' : 'OFF' })
const sync = async () => paint((await chrome.storage.local.get({ on: true })).on)

chrome.runtime.onInstalled.addListener(sync)
// Versions up to 2.4 kept these in local storage; copy them once so the move to sync doesn't drop them.
chrome.runtime.onInstalled.addListener(async () => {
  const old = await chrome.storage.local.get(['niches', 'seekbar'])
  if (!Object.keys(old).length) return
  await chrome.storage.sync.set({ ...old, ...await chrome.storage.sync.get(['niches', 'seekbar']) })
  await chrome.storage.local.remove(['niches', 'seekbar'])
})
chrome.runtime.onStartup.addListener(sync)

chrome.action.onClicked.addListener(async () => {
  const { on } = await chrome.storage.local.get({ on: true })
  await chrome.storage.local.set({ on: !on })
  paint(!on)
})
