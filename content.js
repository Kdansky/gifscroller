// Short clips keep looping until they've been watched this long, so a 1s gif doesn't flash past.
const MIN_SECONDS = 4
// One of: trending, best, hot, latest, oldest. The API serves at most 100 pages per niche, so this decides which 8000 gifs are in the pool.
const ORDER = 'best'

let on = true
let niches = []
let seekbar = true
let adult = false
chrome.storage.local.get({ on: true, niches: [], seekbar: true, adult: false })
  .then(s => [on, niches, seekbar, adult] = [s.on, s.niches, s.seekbar, s.adult])
chrome.storage.onChanged.addListener(c => {
  if (c.on) on = c.on.newValue
  if (c.niches) niches = c.niches.newValue
  if (c.seekbar) seekbar = c.seekbar.newValue
  if (c.adult) adult = c.adult.newValue
})

const shuffle = a => a.sort(() => Math.random() - 0.5)

// RedGifs rate-limits per IP, and its own player shares that budget, so our calls queue up at least this far apart.
const GAP_MS = 2000
let nextCall = 0

async function get(path, token) {
  const wait = nextCall - Date.now()
  nextCall = Math.max(Date.now(), nextCall) + GAP_MS
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  const r = await fetch('https://api.redgifs.com/v2/' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${path}`), { status: r.status })
  return r.json()
}

let auth = null
// Page counts barely change, so one lookup per niche is enough.
const pageCounts = new Map()
// Each page holds 80 gifs; using them all instead of one per fetch is what keeps us under the rate limit.
const pools = new Map()

// Tries niches in random order so one disabled or misspelled niche doesn't stall the rotation.
async function randomGif() {
  // A failed token request mustn't stay cached, or every later call fails without asking again.
  auth ??= get('auth/temporary').then(j => j.token).catch(e => {
    auth = null
    throw e
  })
  const token = await auth
  for (const niche of shuffle([...niches])) {
    if (pools.get(niche)?.length) return pools.get(niche).pop()
    try {
      const page = p => get(`niches/${niche}/gifs?order=${ORDER}&count=80&page=${p}`, token)
      const n = pageCounts.get(niche)
      const j = await page(n ? 1 + Math.floor(Math.random() * n) : 1)
      pageCounts.set(niche, Math.min(j.pages, 100))
      // type 2 is a still image, which would never end
      const gifs = shuffle(j.gifs.filter(g => g.type === 1))
      pools.set(niche, gifs)
      if (gifs.length) return gifs.pop()
    } catch (e) {
      console.warn('[auto-advance]', niche, e)
      // Trying the other niches would only hit the same limit, and the token is still good.
      if (e.status === 429) return
      if (e.status === 401) break
    }
  }
  // Every niche failing usually means the token expired.
  auth = null
}

const site = location.hostname.match(/redgifs|youtube|tiktok|instagram|facebook|snapchat/)[0]

// RedGifs' fullscreen is its own CSS mode, not the browser Fullscreen API; it marks the feed's scroll container with this class.
const fullscreen = () => !!document.querySelector('.fullScreen, .mobileFullscreen')

// YouTube is a single-page app, so the script runs on every page and must stay out of regular /watch videos.
const active = {
  redgifs: () => adult && fullscreen(),
  youtube: () => location.pathname.startsWith('/shorts/'),
  tiktok: () => true,
  instagram: () => location.pathname.startsWith('/reels/'),
  facebook: () => location.pathname.startsWith('/reel/'),
  snapchat: () => location.pathname.includes('/spotlight'),
}[site]

// Random niches get our own player on top of RedGifs' fullscreen feed: loading another gif's page would reload and drop
// out of fullscreen. The spare video preloads the next gif so switching has no gap.
let player = null

// Gifs already watched, so ArrowUp can go back; `pos` is the one on screen.
const HISTORY = 200

function record(g) {
  const { hist } = player
  hist.push(g)
  if (hist.length > HISTORY) hist.shift()
  player.pos = hist.length - 1
}

function put(v, g) {
  v.gif = g
  v.poster = g.urls.poster
  v.src = g.urls.hd
}

// Failures back off up to a minute: retrying fast keeps a rate limit going, which then blocks RedGifs' own player too.
// A newer load or a jump through history supersedes a pending one, which would otherwise overwrite it.
async function load(v, wait = 3000) {
  const req = v.req = {}
  const g = await randomGif().catch(e => console.warn('[auto-advance]', e))
  if (!v.isConnected || v.req !== req) return
  if (!g) return setTimeout(() => v.req === req && load(v, Math.min(wait * 2, 60000)), wait)
  put(v, g)
  if (v === player.shown) {
    record(g)
    v.play()
  }
}

// Dropping the src alone keeps the decoder and buffered video alive until the next load; over hours that piles up.
function release(v) {
  v.req = v.gif = null
  v.removeAttribute('src')
  v.load()
}

function show(v) {
  v.style.visibility = 'visible'
  if (v.src) v.play()
}

function openPlayer() {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000'
  const [shown, spare] = [0, 1].map(() => {
    const v = el.appendChild(document.createElement('video'))
    Object.assign(v, { loop: true, muted: true, playsInline: true, preload: 'auto' })
    v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;visibility:hidden'
    // An expired or missing file would otherwise stay black forever.
    v.onerror = () => setTimeout(() => load(v), 3000)
    return v
  })
  // The overlay hides RedGifs' own buttons, so it brings its own way out and its own sound toggle.
  const btn = (text, right, fn) => {
    const b = el.appendChild(document.createElement('button'))
    b.textContent = text
    b.style.cssText = `position:absolute;top:12px;right:${right}px;z-index:1;width:40px;height:40px;border:0;border-radius:50%;` +
      'background:#0008;color:#fff;font-size:20px;cursor:pointer'
    b.onclick = e => {
      e.stopPropagation()
      fn()
    }
    return b
  }
  // RedGifs leaves fullscreen on Escape; the interval then closes the player.
  btn('✕', 12, () => dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  const sound = btn('🔇', 60, mute)
  el.onclick = () => player.shown.paused ? player.shown.play() : player.shown.pause()
  document.querySelectorAll('video').forEach(v => v.pause())
  document.body.append(el)
  player = { el, shown, spare, sound, hist: [], pos: -1 }
  show(shown)
  load(shown)
  load(spare)
}

function mute() {
  const m = !player.shown.muted
  player.shown.muted = player.spare.muted = m
  player.sound.textContent = m ? '🔇' : '🔊'
}

// Replays a gif from history in the shown video; the spare keeps holding the next new one.
function revisit(pos) {
  player.pos = pos
  put(player.shown, player.hist[pos])
  player.shown.req = null
  player.shown.play()
}

function advance() {
  if (player.pos < player.hist.length - 1) return revisit(player.pos + 1)
  const { shown, spare } = player
  player.shown = spare
  player.spare = shown
  show(spare)
  if (spare.gif) record(spare.gif)
  shown.pause()
  shown.style.visibility = 'hidden'
  release(shown)
  load(shown)
}

// Same move as RedGifs' own ArrowDown in fullscreen, where every feed item fills the screen.
const scrollFeed = () => document.querySelector('.previewFeed')?.scrollBy({ top: innerHeight, behavior: 'smooth' })

// Shorts and TikTok feeds are scroll-snap columns: scrolling the video's container by one screen lands on the next one.
function scrollPast(v) {
  for (let el = v.parentElement; el; el = el.parentElement)
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))
      return el.scrollBy({ top: el.clientHeight, behavior: 'smooth' })
  scrollBy({ top: innerHeight, behavior: 'smooth' })
}

// The site's own down button keeps its idea of the current video in sync; TikTok undoes a plain scroll. Scrolling is the
// fallback in case the button gets renamed.
// Instagram's class names are generated, so only the English label identifies its button; other languages scroll instead.
const button = {
  youtube: '#navigation-button-down button',
  tiktok: '[data-e2e="feed-navigation-next"]',
  instagram: '[aria-label="Navigate to next Reel"]',
  snapchat: '#nextSpotlightButton',
}[site]
const next = site === 'redgifs' ? scrollFeed : v => {
  const b = button && document.querySelector(button)
  b ? b.click() : scrollPast(v)
}

// Ads, "you might enjoy" cards and still images never loop, so nothing would signal their end. Skip them once they've held
// the centre for a moment: a gif only gets its video class after becoming active, so an instant check would skip gifs too.
const SKIP_AFTER_MS = 1500
let parked = null
let parkedAt = 0

if (site === 'redgifs') setInterval(() => {
  const want = on && niches.length > 0 && active()
  if (want && !player) openPlayer()
  if (!want && player) {
    player.el.remove()
    release(player.shown)
    release(player.spare)
    player = null
  }
  // RedGifs restarts its own feed videos underneath ours, decoding HD video nobody sees.
  if (player) document.querySelectorAll('video').forEach(v => player.el.contains(v) || v.pause())
  if (!on || player || !active()) return parked = null
  const item = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-feed-item-id]')
  if (!item || item.matches('.GifPreview_isVideo')) return parked = null
  if (item !== parked) [parked, parkedAt] = [item, Date.now()]
  else if (Date.now() - parkedAt > SKIP_AFTER_MS) {
    parked = null
    scrollFeed()
  }
}, 300)

// Capturing on window runs before RedGifs' own listener, which would scroll the hidden feed underneath.
const keys = {
  ArrowDown: advance,
  ArrowUp: () => player.pos > 0 && revisit(player.pos - 1),
  ' ': () => player.el.click(),
  m: mute,
}
addEventListener('keydown', e => {
  if (!player || !keys[e.key] || e.target.closest?.('input, textarea, [contenteditable]')) return
  e.preventDefault()
  e.stopImmediatePropagation()
  keys[e.key]()
}, true)

const seen = new WeakMap()
let cooldown = 0

// The playing video crossing the viewport's middle line is the one being watched; offscreen previews may also loop.
function watched(v) {
  const r = v.getBoundingClientRect()
  // A video that ends rather than loops (TikTok) is already paused by the time `ended` fires.
  return (!v.paused || v.ended) && r.top < innerHeight / 2 && r.bottom > innerHeight / 2
}

function finished(v) {
  if (!on || !active() || Date.now() < cooldown) return
  if (player ? v !== player.shown : !watched(v)) return
  cooldown = Date.now() + 1500
  seen.delete(v)
  if (player) advance()
  else next(v)
}

// Media events don't bubble, but capture-phase listeners on document still see them, including videos added later.
document.addEventListener('play', e => seen.delete(e.target), true)
document.addEventListener('ended', e => finished(e.target), true)

// Videos have `loop` set, so `ended` never fires; detect the jump back to the start instead.
document.addEventListener('timeupdate', e => {
  const v = e.target
  if (!(v instanceof HTMLVideoElement)) return
  const s = seen.get(v) || { t: 0, total: 0 }
  const t = v.currentTime
  const wrapped = t < s.t - 0.5 && s.t > v.duration - 1
  s.total += wrapped ? v.duration - s.t + t : Math.max(0, t - s.t)
  s.t = t
  seen.set(v, s)
  if (wrapped && s.total >= MIN_SECONDS) finished(v)
}, true)

// Instagram reels have no seek bar, and native controls would sit under Instagram's click-catching overlay, so ours floats
// above everything. It follows the centred video even while paused.
if (site === 'instagram') {
  const bar = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 'any' })
  bar.style.cssText = 'position:fixed;z-index:2147483647;margin:0;accent-color:#fff;display:none'
  document.documentElement.append(bar)
  let cur = null
  bar.addEventListener('input', () => cur.currentTime = bar.value * cur.duration)
  setInterval(() => {
    cur = seekbar && active() && [...document.querySelectorAll('video')].find(v => {
      const r = v.getBoundingClientRect()
      return r.top < innerHeight / 2 && r.bottom > innerHeight / 2
    })
    bar.style.display = cur ? 'block' : 'none'
    if (!cur) return
    const r = cur.getBoundingClientRect()
    Object.assign(bar.style, { left: r.left + 8 + 'px', width: r.width - 16 + 'px', top: r.bottom - 18 + 'px' })
    if (!bar.matches(':active')) bar.value = cur.currentTime / cur.duration || 0
  }, 100)
}
