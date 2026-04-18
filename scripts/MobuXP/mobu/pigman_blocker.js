import { world, system } from '@minecraft/server'

const BLOCKED_IDS = [
  'minecraft:zombie_pigman',
  'minecraft:zombified_piglin',
]

// Nether dikecualikan — pigman memang native di sana
const DIMENSIONS = ['minecraft:overworld', 'minecraft:the_end']

function isValid(entity) {
  try {
    return typeof entity.isValid === 'function' ? entity.isValid() : !!entity.isValid
  } catch { return false }
}

function tryRemove(entity) {
  try { entity.remove() } catch { /* interval scan akan coba lagi 1 detik kemudian */ }
}

function handle(entity, source) {
  try {
    if (!isValid(entity)) return
    const { x, y, z } = entity.location
    const typeId = entity.typeId
    tryRemove(entity)
    console.warn(`[Pigman Blocker][${source}] Removed ${typeId} at (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`)
  } catch { /* entity invalid mid-execution, skip */ }
}

// Tangkap spawn baru — block di overworld & the_end, biarkan di nether
world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  try {
    if (!isValid(entity)) return
    if (!BLOCKED_IDS.includes(entity.typeId)) return
    if (entity.dimension.id === 'minecraft:nether') return // biarkan normal di nether
    system.run(() => handle(entity, 'Spawn'))
  } catch { /* entity invalid before system.run, skip */ }
})

// Bersihkan entity lama setiap ~1 detik — overworld & the_end dengan filter type
system.runInterval(() => {
  for (const dimId of DIMENSIONS) {
    try {
      const dimension = world.getDimension(dimId)
      for (const typeId of BLOCKED_IDS) {
        try {
          for (const entity of dimension.getEntities({ type: typeId })) {
            try { handle(entity, 'Scan') } catch { /* entity expired mid-loop */ }
          }
        } catch { /* type query error */ }
      }
    } catch (e) {
      console.warn(`[Pigman Blocker] Scan error (${dimId}):`, e)
    }
  }
}, 20)