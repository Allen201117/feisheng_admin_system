function getStartupSessionAction(options) {
  const user = options && options.user
  const hasConsent = !!(options && options.hasConsent)

  if (!user || !user._id) {
    return 'noop'
  }

  if (!hasConsent || !user.session_token) {
    return 'clear'
  }

  return 'resume'
}

module.exports = {
  getStartupSessionAction
}