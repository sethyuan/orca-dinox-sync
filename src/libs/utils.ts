import { Block } from "../orca"

export function groupBy<K, T>(
  keyFn: (value: T) => K,
  values: T[],
): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const value of values) {
    const key = keyFn(value)
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(value)
  }
  return map
}

export async function ensureInbox(
  container: Block,
  inboxName: string,
): Promise<Block> {
  const notInMemoryBlockIds = []

  for (const blockId of container.children) {
    const block = orca.state.blocks[blockId]
    if (block != null) {
      if (block.text?.trim() === inboxName) {
        return block
      }
    } else {
      notInMemoryBlockIds.push(blockId)
    }
  }

  const blocks: Block[] = await orca.invokeBackend(
    "get-blocks",
    notInMemoryBlockIds,
  )
  const inbox = blocks.find((block) => block.text?.trim() === inboxName)

  if (inbox == null) {
    const inboxBlockId = await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      container,
      "lastChild",
      [{ t: "t", v: inboxName }],
    )
    return orca.state.blocks[inboxBlockId]!
  }

  return inbox!
}
