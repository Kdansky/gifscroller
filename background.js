// Clicking the toolbar icon toggles auto-advance; the badge shows OFF while disabled.
const paint = on => chrome.action.setBadgeText({ text: on ? '' : 'OFF' })
const sync = async () => paint((await chrome.storage.local.get({ on: true })).on)

chrome.runtime.onInstalled.addListener(sync)
chrome.runtime.onStartup.addListener(sync)

chrome.action.onClicked.addListener(async () => {
  const { on } = await chrome.storage.local.get({ on: true })
  await chrome.storage.local.set({ on: !on })
  paint(!on)
})
