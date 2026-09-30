type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The SDK stores session tokens here; passwords never pass through this adapter. */
export function createAuthStorage(
  storageKey: string,
  local: () => BrowserStorage,
  session: () => BrowserStorage,
) {
  const preferenceKey = `${storageKey}:remember-me`
  const sessionKeys = [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]

  function getRememberMe() {
    try { if (session().getItem(preferenceKey) === 'false') return false } catch { /* Try device preference. */ }
    // Keep existing persisted sessions working after this update.
    try { return local().getItem(preferenceKey) !== 'false' } catch { return false }
  }

  function removeFrom(getStorage: () => BrowserStorage, key: string) {
    try { getStorage().removeItem(key) } catch { /* Unavailable browser storage. */ }
  }

  function setRememberMe(remember: boolean) {
    try {
      const target = remember ? local() : session()
      const probeKey = `${storageKey}:storage-check`
      target.setItem(probeKey, '1')
      target.removeItem(probeKey)
    } catch {
      throw new Error(remember
        ? 'O navegador bloqueou o armazenamento. Desmarque “Lembrar de mim” e tente novamente.'
        : 'O navegador bloqueou o armazenamento da sessão. Permita o armazenamento deste site para entrar.')
    }
    if (!remember) session().setItem(preferenceKey, 'false')
    try { local().setItem(preferenceKey, String(remember)) } catch {
      if (remember) throw new Error('Não foi possível salvar a opção “Lembrar de mim”.')
    }
    if (remember) removeFrom(session, preferenceKey)
    // A refresh in another tab must also follow the latest device preference.
    for (const key of sessionKeys) removeFrom(remember ? session : local, key)
  }

  const storage = {
    getItem(key: string) {
      try { return (getRememberMe() ? local() : session()).getItem(key) } catch { return null }
    },
    setItem(key: string, value: string) {
      const remember = getRememberMe()
      const target = remember ? local() : session()
      target.setItem(key, value)
      // Only a new explicit login clears the other store. A background refresh
      // in a temporary tab must not erase a newer remembered login in another tab.
    },
    removeItem(key: string) {
      // Logout/recovery cleanup must not leave a session in the other store.
      removeFrom(local, key)
      removeFrom(session, key)
    },
  }

  return { storage, getRememberMe, setRememberMe }
}
