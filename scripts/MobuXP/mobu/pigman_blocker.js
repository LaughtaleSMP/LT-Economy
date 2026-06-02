import { world, system } from '@minecraft/server'
import { shouldSkipHeavy, isEmergencyMode } from '../shared/tps_gate.js'

const BLOCKED_IDS = new Set([
  'minecraft:zombie_pigman',
  'minecraft:zombified_piglin',
])

const DIMENSIONS = ['minecraft:overworld', 'minecraft:the_end']

function handle(entity) {
  try {
    // [PERF v4.0] Simplified isValid check — try remove, catch if invalid
    entity.remove()
  } catch {}
}

// [PERF] entitySpawn is lightweight — just a Set.has + remove
world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  try {
    if (!entity || !BLOCKED_IDS.has(entity.typeId)) return
    if (entity.dimension.id === 'minecraft:nether') return
    system.run(() => handle(entity))
  } catch {}
})

// [PERF v4.0] Periodic scan with TPS awareness:
//   - Skip entirely when TPS < 10 (emergency) or TPS < 15 (heavy)
//   - Uses per-type targeted query instead of iterating all entities
system.runInterval(() => {
  if (shouldSkipHeavy()) return
  for (const dimId of DIMENSIONS) {
    try {
      const dimension = world.getDimension(dimId)
      for (const typeId of BLOCKED_IDS) {
        try {
          for (const entity of dimension.getEntities({ type: typeId })) {
            try { entity.remove() } catch {}
          }
        } catch {}
      }
    } catch {}
  }
}, 100)