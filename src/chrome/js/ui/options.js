import asynchrome from '../core/asynchrome'
import proxy from '../core/proxy'

(async () => {
  const { censortracker: { chromeListeners } } = await asynchrome.runtime.getBackgroundPage()

  const useProxyCheckbox = document.getElementById('useProxyCheckbox')
  const useNotificationsCheckbox = document.getElementById('useNotificationsCheckbox')
  const isProxyControlledByThisExtension = await proxy.controlledByThisExtension()
  const isProxyControlledByOtherExtensions = await proxy.controlledByOtherExtensions()

  if (isProxyControlledByOtherExtensions) {
    useProxyCheckbox.checked = false
    useProxyCheckbox.disabled = true
    await asynchrome.storage.local.set({ useProxyChecked: false })
  } else if (isProxyControlledByThisExtension) {
    useProxyCheckbox.checked = true
    useProxyCheckbox.disabled = false
    await asynchrome.storage.local.set({ useProxyChecked: true })
  } else {
    await asynchrome.storage.local.set({ useProxyChecked: false })
    useProxyCheckbox.disabled = false
  }

  useProxyCheckbox.addEventListener('change', async () => {
    if (useProxyCheckbox.checked) {
      if (!chromeListeners.has()) {
        chromeListeners.add()
      }

      await proxy.setProxy()
      useProxyCheckbox.checked = true
      console.log('Proxying enabled.')
    } else {
      await proxy.removeProxy()
      useProxyCheckbox.checked = false
      console.warn('Proxying disabled.')
    }
  }, false)

  useNotificationsCheckbox.addEventListener('change', async () => {
    if (useNotificationsCheckbox.checked) {
      await asynchrome.storage.local.set({ useNotificationsChecked: true })
      console.log('Notifications enabled.')
    } else {
      console.warn('Notifications disabled.')
      await asynchrome.storage.local.set({ useNotificationsChecked: false })
    }
  }, false)

  const { useProxyChecked, useNotificationsChecked } =
    await asynchrome.storage.local.get({
      useProxyChecked: true,
      useNotificationsChecked: true,
    })

  useProxyCheckbox.checked = useProxyChecked
  useNotificationsCheckbox.checked = useNotificationsChecked
})()
