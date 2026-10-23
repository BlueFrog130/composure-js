// Webhook Events: every install is logged to the maintainers' log channel, and whoever adds the bot
// to a server gets a DM on setting up announcements.
import { Button, type EventContext, Row, Text, type WebhookEvent } from "composurejs";
import { createDM, createMessage } from "composurejs/rest";
import type { BotEnv } from "./env.ts";
import * as ui from "./ui.tsx";

const GUIDE = "https://bluefrog130.github.io/composure-js/";
/** `integration_type`s */
const GUILD_INSTALL = 0;
const USER_INSTALL = 1;

/** The Event Handler: `APPLICATION_AUTHORIZED` only. */
export async function onEvent(c: EventContext<BotEnv>, event: WebhookEvent) {
  if (event.type !== "APPLICATION_AUTHORIZED") return;
  const { user, guild, integration_type } = event.data;
  const by = `<@${user.id}> (${user.username})`;
  const log =
    integration_type === GUILD_INSTALL && guild ? (
      <ui.Secondary title="Added to a server">
        <Text>
          **{guild.name}** (`{guild.id}`) by {by}
        </Text>
      </ui.Secondary>
    ) : integration_type === USER_INSTALL ? (
      <ui.Secondary title="Added to a user's apps">
        <Text>{by}</Text>
      </ui.Secondary>
    ) : undefined;
  if (!log) return;
  await createMessage(c.bot, c.data.config.logChannel, log);
  console.info({ msg: "logged install", userId: user.id });

  if (integration_type !== GUILD_INSTALL || !guild) return;
  // Best effort: the installer may not accept DMs
  try {
    const dm = await createDM(c.bot, user.id);
    await createMessage(
      c.bot,
      dm.id,
      <ui.Primary title="Thanks for adding composurejs!">
        <Text>In **{guild.name}**, run `/notify setup` to get an announcement whenever a new version is released, or `/changelog` to read what changed.</Text>
        <Row>
          <Button url={GUIDE}>Read the guide</Button>
        </Row>
      </ui.Primary>,
    );
  } catch (error) {
    console.debug({ msg: "could not DM the installer", error: String(error) });
  }
}
