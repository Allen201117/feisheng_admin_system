function chunkList(list, size) {
  const chunkSize = Math.max(1, parseInt(size, 10) || 1)
  const chunks = []
  for (let i = 0; i < (list || []).length; i += chunkSize) {
    chunks.push(list.slice(i, i + chunkSize))
  }
  return chunks
}

function buildCopiedProcessData(process, options) {
  const serverDate = options.serverDate
  const assignedUserIds = Array.isArray(process.assigned_user_ids)
    ? process.assigned_user_ids.slice()
    : []

  return {
    org_id: options.orgId,
    order_id: options.newOrderId,
    process_name: process.process_name,
    current_price: process.current_price,
    note: process.note || '',
    assigned_user_ids: assignedUserIds,
    status: process.status || 'active',
    created_at: serverDate(),
    updated_at: serverDate()
  }
}

async function copyProcessDocsInChunks(processes, options) {
  const addProcess = options.addProcess
  const chunkSize = options.chunkSize || 10
  let copiedCount = 0

  for (const chunk of chunkList(processes || [], chunkSize)) {
    await Promise.all(chunk.map(async (process) => {
      const data = buildCopiedProcessData(process, options)
      await addProcess(data)
      copiedCount += 1
    }))
  }

  return { copiedCount }
}

module.exports = {
  chunkList,
  buildCopiedProcessData,
  copyProcessDocsInChunks
}
