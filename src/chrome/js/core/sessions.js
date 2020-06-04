class BrowserSession {
  constructor () {
    this.requests = new Map()
  }

  putRequest (id, key, value) {
    if (!this.requests.has(id)) {
      this.requests.set(id, {})
    }

    this.requests.get(id)[key] = value
  }

  getRequest (id, key, defaultValue) {
    if (!this.requests.has(id)) {
      return defaultValue
    }

    const request = this.requests.get(id)

    return typeof request[key] !== 'undefined' && request[key] || defaultValue
  }

  deleteRequest (id) {
    if (this.requests.has(id)) {
      this.requests.delete(id)
    }
  }
}

export default new BrowserSession()
