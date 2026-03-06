// privacy.js - 隐私协议版本与本地同意缓存
const CONSENT_STORAGE_KEY = 'privacy_consent_version'
const CONSENT_VERSION = '2026-03-05-v1'

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

module.exports = {
  CONSENT_VERSION,
  getConsentVersion,
  hasCurrentConsent,
  markConsentAccepted
}
