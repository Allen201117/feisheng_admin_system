// privacy.js - 隐私协议版本与本地同意缓存
const CONSENT_STORAGE_KEY = 'privacy_consent_version'
const CONSENT_VERSION = '2026-05-01-v2'

function getConsentVersion() {
  try {
    return wx.getStorageSync(CONSENT_STORAGE_KEY) || ''
  } catch (e) {
    return ''
  }
}

function hasCurrentConsent() {
  return getConsentVersion() === CONSENT_VERSION
}

function markConsentAccepted() {
  try {
    wx.setStorageSync(CONSENT_STORAGE_KEY, CONSENT_VERSION)
  } catch (e) {
    // ignore
  }
}

function clearConsentAccepted() {
  try {
    wx.removeStorageSync(CONSENT_STORAGE_KEY)
  } catch (e) {
    // ignore
  }
}

module.exports = {
  CONSENT_VERSION,
  getConsentVersion,
  hasCurrentConsent,
  markConsentAccepted,
  clearConsentAccepted
}
