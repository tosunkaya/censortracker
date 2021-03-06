import {
  asynchrome,
  errors,
  ignore,
  proxy,
  registry,
  settings,
} from './core'
import {
  enforceHttpConnection,
  enforceHttpsConnection,
  extractHostnameFromUrl,
  validateUrl,
} from './core/utilities'

window.censortracker = {
  proxy,
  registry,
  settings,
  errors,
  ignore,
  asynchrome,
  extractHostnameFromUrl,
}

/**
 * Fires when a request is about to occur. This event is sent before any TCP
 * connection is made and can be used to cancel or redirect requests.
 * @param url Current URL address.
 * @returns {undefined|{redirectUrl: *}} Undefined or redirection to HTTPS§.
 */
const onBeforeRequestListener = ({ url }) => {
  const { hostname } = new URL(url)

  if (ignore.isIgnoredHost(hostname)) {
    console.warn(`Ignoring host: ${url}`)
    return undefined
  }
  proxy.allowProxying()
  return {
    redirectUrl: enforceHttpsConnection(url),
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  onBeforeRequestListener, {
    urls: ['http://*/*'],
    types: ['main_frame'],
  }, ['blocking'],
)

/**
 * Fires when a request could not be processed successfully.
 * @param url Current URL address.
 * @param error The error description.
 * @param tabId The ID of the tab in which the request takes place.
 * @returns {undefined} Undefined.
 */
const onErrorOccurredListener = async ({ url, error, tabId }) => {
  const { hostname } = new URL(url)

  if (ignore.isIgnoredHost(hostname)) {
    return
  }

  if (errors.isThereProxyConnectionError(error)) {
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL('proxy_unavailable.html'),
    })
    return
  }

  if (errors.isThereConnectionError(error)) {
    const isProxyControlledByOtherExtensions = await proxy.controlledByOtherExtensions()
    const isProxyControlledByThisExtension = await proxy.controlledByThisExtension()

    if (!isProxyControlledByOtherExtensions && !isProxyControlledByThisExtension) {
      chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL(`proxy_disabled.html?${window.btoa(url)}`),
      })
      return
    }

    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(`unavailable.html?${window.btoa(url)}`),
    })
    await registry.addBlockedByDPI(hostname)
    await proxy.setProxy()
    return
  }

  await ignore.addHostToIgnore(hostname)
  chrome.tabs.remove(tabId)
  chrome.tabs.create({
    url: enforceHttpConnection(url),
  })
}

chrome.webRequest.onErrorOccurred.addListener(
  onErrorOccurredListener,
  {
    urls: ['http://*/*', 'https://*/*'],
    types: ['main_frame'],
  },
)

const notificationOnButtonClicked = async (notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    const [tab] = await asynchrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })

    const { hostname } = new URL(tab.url)
    const { mutedForever } =
      await asynchrome.storage.local.get({ mutedForever: [] })

    if (!mutedForever.find((item) => item === hostname)) {
      mutedForever.push(hostname)

      try {
        await asynchrome.storage.local.set({ mutedForever })
        console.warn(`We won't notify you about ${hostname} anymore`)
      } catch (error) {
        console.error(error)
      }
    }
  }
}

const updateTabState = async () => {
  const [tab] = await asynchrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })

  if (!tab || !validateUrl(tab.url)) {
    return
  }

  const { enableExtension, useNotificationsChecked } =
    await asynchrome.storage.local.get({
      enableExtension: true,
      useNotificationsChecked: true,
    })

  if (!enableExtension) {
    settings.setDisableIcon(tab.id)
    return
  }

  const { hostname } = new URL(tab.url)
  const currentHostname = extractHostnameFromUrl(hostname)

  if (ignore.isIgnoredHost(currentHostname)) {
    return
  }

  const { domainFound } = await registry.domainsContains(currentHostname)
  const { url: distributorUrl, cooperationRefused } =
    await registry.distributorsContains(currentHostname)

  if (domainFound) {
    settings.setDangerIcon(tab.id)
    return
  }

  if (distributorUrl) {
    settings.setDangerIcon(tab.id)
    if (useNotificationsChecked && !cooperationRefused) {
      await showCooperationAcceptedWarning(currentHostname)
    }
  }
}

const showCooperationAcceptedWarning = async (hostname) => {
  const { notifiedHosts, mutedForever } =
    await asynchrome.storage.local.get({
      notifiedHosts: [],
      mutedForever: [],
    })

  if (mutedForever.includes(hostname)) {
    return
  }

  if (!notifiedHosts.includes(hostname)) {
    await asynchrome.notifications.create({
      type: 'basic',
      title: settings.getName(),
      priority: 2,
      message: `${hostname} может передавать информацию третьим лицам.`,
      buttons: [
        { title: '\u2715 Не показывать для этого сайта' },
        { title: '\u2192 Подробнее' },
      ],
      iconUrl: settings.getDangerIcon(),
    })

    try {
      notifiedHosts.push(hostname)
      await asynchrome.storage.local.set({ notifiedHosts })
    } catch (error) {
      console.error(error)
    }
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({
          pageUrl: {
            schemes: ['http', 'https'],
          },
        }),
      ],
      actions: [new chrome.declarativeContent.ShowPageAction()],
    }])
  })

  if (reason === 'install') {
    const synced = await registry.syncDatabase()

    if (synced) {
      settings.enableExtension()
      await proxy.setProxy()
    }
  }
})

const onTabCreated = async ({ id }) => {
  const { enableExtension } =
    await asynchrome.storage.local.get({
      enableExtension: true,
    })

  if (enableExtension) {
    settings.setDefaultIcon(id)
  } else {
    settings.setDisableIcon(id)
  }
}

chrome.tabs.onCreated.addListener(onTabCreated)

chrome.runtime.onStartup.addListener(async () => {
  await registry.syncDatabase()
  await updateTabState()
})

chrome.windows.onRemoved.addListener(async (_windowId) => {
  await asynchrome.storage.local.remove('notifiedHosts').catch(console.error)
  console.warn('A list of notified hosts has been cleaned up!')
})

chrome.proxy.onProxyError.addListener((details) => {
  console.error(`Proxy error: ${JSON.stringify(details)}`)
})

chrome.tabs.onActivated.addListener(updateTabState)
chrome.tabs.onUpdated.addListener(updateTabState)
chrome.notifications.onButtonClicked.addListener(notificationOnButtonClicked)

// The mechanism for controlling handlers from popup.js
window.censortracker.chromeListeners = {
  has: () => {
    const hasOnErrorOccurredListener =
      chrome.webRequest.onErrorOccurred.hasListener(onErrorOccurredListener)
    const hasOnBeforeRequestListener =
      chrome.webRequest.onBeforeRequest.hasListener(onBeforeRequestListener)

    return hasOnBeforeRequestListener && hasOnErrorOccurredListener
  },
  remove: () => {
    chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurredListener)
    chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestListener)
    console.warn('CensorTracker: listeners removed')
  },
  add: () => {
    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurredListener, {
      urls: ['http://*/*', 'https://*/*'],
      types: ['main_frame'],
    })
    chrome.webRequest.onBeforeRequest.addListener(
      onBeforeRequestListener, {
        urls: ['http://*/*'],
        types: ['main_frame'],
      },
      ['blocking'],
    )
    console.warn('CensorTracker: listeners added')
  },
}
