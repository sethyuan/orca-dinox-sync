import { formatDate, startOfDay } from "date-fns"
import LogoImg from "../icon.png"
import { setupL10N, t } from "./libs/l10n"
import { ensureInbox, groupBy } from "./libs/utils"
import type { Block, DbId, QueryDescription } from "./orca"
import zhCN from "./translations/zhCN"

let pluginName: string

export async function load(_name: string) {
  pluginName = _name

  // Your plugin code goes here.
  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  const Button = orca.components.Button
  const HoverContextMenu = orca.components.HoverContextMenu
  const MenuText = orca.components.MenuText

  await orca.plugins.setSettingsSchema(pluginName, {
    token: {
      label: t("Token"),
      description: t(
        "The Dinox API token that you can find in settings -> sync -> API Token.",
      ),
      type: "string",
    },
    inboxName: {
      label: t("Inbox name"),
      description: t(
        "The text used for the block where imported notes are placed under.",
      ),
      type: "string",
      defaultValue: "Dinox Inbox",
    },
    noteTag: {
      label: t("Note tag"),
      description: t("The tag applied to imported notes."),
      type: "string",
      defaultValue: "Dinox Note",
    },
  })

  orca.themes.injectCSSResource(`${pluginName}/dist/main.css`, pluginName)

  if (orca.state.commands["dinox.sync"] == null) {
    orca.commands.registerCommand(
      "dinox.sync",
      async (fullSync: boolean = false) => {
        const settings = orca.state.plugins[pluginName].settings

        if (!settings?.token) {
          orca.notify(
            "error",
            t("Please provide a Dinox API token in plugin settings."),
          )
          return
        }

        orca.notify("info", t("Starting to sync, please wait..."))

        const inboxName = settings?.inboxName || "Dinox Inbox"
        const noteTag = settings?.noteTag || "Dinox Note"

        const syncKey = fullSync
          ? "1900-01-01 00:00:00"
          : (await orca.plugins.getData(pluginName, "syncKey")) ??
            "1900-01-01 00:00:00"
        const now = new Date()

        try {
          const res = await fetch(
            "https://dinoai.chatgo.pro/openapi/v5/notes",
            {
              method: "POST",
              headers: {
                Authorization: settings.token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                template: "",
                noteId: 0,
                lastSyncTime: syncKey,
              }),
            },
          )
          const json = await res.json()
          const notes = json.data?.[0]?.notes?.filter(
            (note: any) => !note.isDel,
          ) as any[]

          if (!notes?.length) {
            orca.notify("info", t("Nothing to sync."))
            return
          }

          const notesByDate = groupBy<Date, any>(
            (note) => startOfDay(note.createTime).getTime(),
            notes,
          )

          await orca.commands.invokeGroup(async () => {
            for (const [date, notesInDate] of notesByDate.entries()) {
              const createdAt = new Date(date)
              const journal: Block = await orca.invokeBackend(
                "get-journal-block",
                createdAt,
              )
              if (journal == null) continue
              const inbox = await ensureInbox(journal, inboxName)

              for (const note of notesInDate) {
                await syncNote(note, inbox, noteTag)
              }
            }
          })

          await orca.plugins.setData(
            pluginName,
            "syncKey",
            formatDate(now, "yyyy-MM-dd HH:mm:ss"),
          )

          orca.notify("success", t("Dinox notes synced successfully."))
        } catch (err) {
          orca.notify("error", t("Failed to sync Dinox notes."))
        }
      },
      t("Sync new notes"),
    )
  }

  if (orca.state.headbarButtons["dinox.sync"] == null) {
    orca.headbar.registerHeadbarButton("dinox.sync", () => (
      <HoverContextMenu
        menu={(closeMenu: () => void) => (
          <>
            <MenuText
              title={t("Incremental sync")}
              onClick={async () => {
                closeMenu()
                await orca.commands.invokeCommand("dinox.sync")
              }}
            />
            <MenuText
              title={t("Full sync")}
              onClick={async () => {
                closeMenu()
                await orca.commands.invokeCommand("dinox.sync", true)
              }}
            />
          </>
        )}
      >
        <Button
          variant="plain"
          onClick={() => orca.commands.invokeCommand("dinox.sync")}
        >
          <img className="dinox-button" src={LogoImg} alt="Sync" />
        </Button>
      </HoverContextMenu>
    ))
  }

  console.log(`${pluginName} loaded.`)
}

export async function unload() {
  // Clean up any resources used by the plugin here.
  orca.headbar.unregisterHeadbarButton("dinox.sync")
  orca.commands.unregisterCommand("dinox.sync")
  orca.themes.removeCSSResources(pluginName)

  console.log(`${pluginName} unloaded.`)
}

async function syncNote(note: any, inbox: Block, noteTag: string) {
  let noteBlock: Block

  // Perform a query to see if there is an existing note.
  const resultIds = (await orca.invokeBackend("query", {
    q: {
      kind: 1,
      conditions: [
        {
          kind: 4,
          name: noteTag,
          properties: [{ name: "ID", op: 1, value: note.noteId }],
        },
      ],
    },
    pageSize: 1,
  } as QueryDescription)) as DbId[]

  if (resultIds.length > 0) {
    const noteBlockId = resultIds[0]
    noteBlock = orca.state.blocks[noteBlockId]
    if (noteBlock == null) {
      noteBlock = await orca.invokeBackend("get-block", noteBlockId)
      if (noteBlock == null) return
      orca.state.blocks[noteBlock.id] = noteBlock
    }

    // Clear the tags of the existing note.
    await orca.commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [noteBlock.id],
      [{ name: "_tags", type: 2, value: [] }],
    )

    // Clear the children of the existing note.
    if (noteBlock.children.length > 0) {
      await orca.commands.invokeEditorCommand(
        "core.editor.deleteBlocks",
        null,
        [...noteBlock.children],
      )
    }
  } else {
    const noteBlockId = await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      inbox,
      "lastChild",
      [{ t: "t", v: note.title }],
      { type: "text" },
      new Date(note.createTime),
      new Date(note.updateTime),
    )
    noteBlock = orca.state.blocks[noteBlockId]
  }

  const tagBlockId = await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    null,
    noteBlock.id,
    noteTag,
    [{ name: "ID", type: 1, value: note.noteId }],
  )
  // Add the ID tag property if it doesn't exist.
  const tagBlock = orca.state.blocks[tagBlockId]
  if (!tagBlock.properties?.some((p) => p.name === "ID")) {
    await orca.commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [tagBlock.id],
      [{ name: "ID", type: 1 }],
    )
  }

  // Add note tags.
  if (note.tags?.length) {
    for (const tag of note.tags) {
      await orca.commands.invokeEditorCommand(
        "core.editor.insertTag",
        null,
        noteBlock.id,
        tag,
      )
    }
  }

  // Insert the content of the note.
  await orca.commands.invokeEditorCommand(
    "core.editor.batchInsertText",
    null,
    noteBlock,
    "firstChild",
    note.contentMd,
  )

  // Insert the audio if available.
  if (note.audioDetail?.remote) {
    await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      noteBlock,
      "firstChild",
      null,
      { type: "audio", src: note.audioDetail.remote },
    )
  }
}
