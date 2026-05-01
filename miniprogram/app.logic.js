function getStartupSessionAction(options) {
  const user = options && options.user
  const hasConsent = !!(options && options.hasConsent)

  if (!user || !user._id) {
    return 'noop'
  }

  if (!user.session_token) {
    return 'clear'
  }

  if (!hasConsent) {
    return 'noop'
  }

  return 'resume'
}

module.exports = {
  getStartupSessionAction
}
