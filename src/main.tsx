import { formatDate, startOfDay } from "date-fns"
import LogoImg from "../icon.png"
import { setupL10N, t } from "./libs/l10n"
import { ensureInbox, groupBy } from "./libs/utils"
import { Block } from "./orca"
import zhCN from "./translations/zhCN"

let pluginName: string

export async function load(_name: string) {
  pluginName = _name

  // Your plugin code goes here.
  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  const Tooltip = orca.components.Tooltip
  const Button = orca.components.Button

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
  })

  orca.themes.injectCSSResource(`${pluginName}/dist/main.css`, pluginName)

  if (orca.state.commands["dinox.sync"] == null) {
    orca.commands.registerCommand(
      "dinox.sync",
      async () => {
        const settings = orca.state.plugins[pluginName].settings

        if (!settings?.token) {
          orca.notify(
            "error",
            t("Please provide a Dinox API token in plugin settings."),
          )
          return
        }

        const inboxName = settings?.inboxName || "Dinox Inbox"

        const syncKey =
          (await orca.plugins.getData(pluginName, "syncKey")) ??
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
                const noteBlockId = await orca.commands.invokeEditorCommand(
                  "core.editor.insertBlock",
                  null,
                  inbox,
                  "lastChild",
                  [{ t: "t", v: note.title }],
                )

                if (note.tags?.length) {
                  for (const tag of note.tags) {
                    await orca.commands.invokeEditorCommand(
                      "core.editor.insertTag",
                      null,
                      noteBlockId,
                      tag,
                    )
                  }
                }

                const noteBlock = orca.state.blocks[noteBlockId]

                await orca.commands.invokeEditorCommand(
                  "core.editor.batchInsertText",
                  null,
                  noteBlock,
                  "firstChild",
                  note.contentMd,
                )

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
      <Tooltip
        text={t("Sync new notes")}
        shortcut={orca.state.shortcuts["dinox.sync"]}
      >
        <Button
          variant="plain"
          onClick={() => orca.commands.invokeCommand("dinox.sync", null)}
        >
          <img className="dinox-button" src={LogoImg} alt="Sync" />
        </Button>
      </Tooltip>
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
