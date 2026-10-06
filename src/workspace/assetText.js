const TYPE_LABEL = { image: 'Image', pdf: 'PDF', note: 'Note', model: '3D model' }

export function firstLine(text) {
  return String(text || '').trim().split('\n')[0].slice(0, 80)
}

export function displayTitle(record) {
  return record.title || record.filename || (record.type === 'note' ? firstLine(record.notes) : '')
}

// Spoken / accessible description, including depth so screen-reader users hear the layer.
export function describeAsset(record) {
  const name = displayTitle(record)
  const turn = record.rotY ? `, turned ${record.rotY}°` : ''
  return `${TYPE_LABEL[record.type] || 'Item'}${name ? `: ${name}` : ''}, layer ${record.z}${turn}`
}
