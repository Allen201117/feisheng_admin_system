function canSaveSettings(state) {
  if (!state || state.loaded !== true) {
    return { ok: false, msg: '设置未加载完成，暂不能保存' }
  }
  return { ok: true }
}

function createCheckpointDraft(data) {
  var source = data || {}
  return {
    name: source.name || '',
    latitude: source.latitude === undefined || source.latitude === null ? '' : String(source.latitude),
    longitude: source.longitude === undefined || source.longitude === null ? '' : String(source.longitude),
    radius: source.radius === undefined || source.radius === null ? '100' : String(source.radius)
  }
}

function buildCheckpointPayload(state) {
  var payload = []
  var mainLat = Number(state.factory_latitude)
  var mainLng = Number(state.factory_longitude)
  var globalRadius = parseInt(state.geofence_radius, 10) || 100

  if (Number.isFinite(mainLat) && Number.isFinite(mainLng)) {
    payload.push({
      name: '主打卡点',
      latitude: mainLat,
      longitude: mainLng,
      radius: globalRadius
    })
  }

  ;(state.checkpoints || []).forEach(function(item) {
    if (!item) return
    if (String(item.latitude || '').trim() === '' || String(item.longitude || '').trim() === '') return
    var lat = Number(item.latitude)
    var lng = Number(item.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    payload.push({
      name: item.name || '附加打卡点',
      latitude: lat,
      longitude: lng,
      radius: globalRadius
    })
  })

  return payload
}

module.exports = {
  canSaveSettings,
  createCheckpointDraft,
  buildCheckpointPayload
}