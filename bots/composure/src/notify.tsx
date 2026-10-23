// Release announcements. The cron trigger posts each new release in the home server's announcement
// channel and publishes it; servers get it through Discord's channel following, set up by
// `/notify setup`. Nothing is stored per server: a server's subscriptions are its channel follower
// webhooks whose source is that announcement channel. composure-rs's bot follows its own channel the
// same way, so in a server with both, each bot sees and removes only its own followers.
import { Button, type CommandContext, DiscordApiError, option, Permission, Row, Separator, Text, UserError } from "composurejs";
import { type BotClient, createMessage, crosspostMessage, deleteWebhook, getGuildWebhooks, route } from "composurejs/rest";
import { type BotEnv, command, type Config, type Data, group } from "./env.ts";
import { excerpt, loadReleases, position, refreshReleases, type Release, tidy } from "./releases.ts";
import * as ui from "./ui.tsx";

/** The last version announced. */
export const ANNOUNCED_KEY = "announced";
/** Room for the notes within Discord's 4000 characters of text per message. */
const NOTES_LIMIT = 3500;
/** Webhook type of a channel follower. */
const CHANNEL_FOLLOWER = 2;
/** Text and announcement channels: where followed posts can go. */
const FOLLOWABLE = [0, 5];
const GUIDE = "https://bluefrog130.github.io/composure-js/";

// Not wrapped in composurejs/rest yet: the route, typed from the spec by its operationId.
const followChannel = route("POST", "/channels/{channel_id}/followers", "follow_channel");

interface Follower {
  id: string;
  channel_id?: string | null;
}

const mention = (channel: string) => `<#${channel}>`;

function guildOf(c: CommandContext<BotEnv>): string {
  if (!c.guildId) throw new UserError("Use this in a server.");
  return c.guildId;
}

/** A missing permission as a message the user can act on; other failures as they are. */
function permissionError(error: unknown, where: string): unknown {
  if (error instanceof DiscordApiError && error.status === 403) {
    return new UserError(`I need the **Manage Webhooks** permission ${where} to manage announcements. Grant it to my role, or add me again with \`/invite\`.`);
  }
  return error;
}

/** This server's webhooks following the announcement channel. */
async function followers(bot: BotClient, guild: string, config: Config): Promise<Follower[]> {
  const webhooks = await getGuildWebhooks(bot, guild).catch((error: unknown) => {
    throw permissionError(error, "in this server");
  });
  return (webhooks ?? []).filter((w) => w.type === CHANNEL_FOLLOWER && (w as { source_channel?: { id: string } | null }).source_channel?.id === config.announceChannel);
}

const mentions = (webhooks: Follower[]) => webhooks.flatMap((w) => (w.channel_id ? [mention(w.channel_id)] : [])).join(", ");

const setup = command({
  name: "setup",
  description: "Announce new composurejs releases in a channel",
  options: { channel: option.channel("Where announcements go", { types: FOLLOWABLE }) },
  handler: async (c, { channel }) => {
    const guild = guildOf(c);
    const { config } = c.data;
    if (channel.id === config.announceChannel) throw new UserError("That is the announcement channel itself.");
    if ((await followers(c.bot, guild, config)).some((w) => w.channel_id === channel.id)) {
      return c.ephemeral(
        <ui.Secondary>
          <Text>{mention(channel.id)} already gets composurejs release announcements.</Text>
        </ui.Secondary>,
      );
    }
    await c.bot
      .request(followChannel, { params: { channel_id: config.announceChannel }, body: { webhook_channel_id: channel.id }, reason: `/notify setup by ${c.user.username}` })
      .catch((error: unknown) => {
        throw permissionError(error, `in ${mention(channel.id)}`);
      });
    return c.ephemeral(
      <ui.Success title="Announcements on">
        <Text>New composurejs releases will be announced in {mention(channel.id)}.</Text>
        <Text>-# `/notify preview` shows what they look like; `/notify remove` stops them.</Text>
      </ui.Success>,
    );
  },
});

const remove = command({
  name: "remove",
  description: "Stop composurejs release announcements",
  options: { channel: option.channel("Only this channel (default: every channel)", { types: FOLLOWABLE }).optional() },
  handler: async (c, { channel }) => {
    const guild = guildOf(c);
    const removed = (await followers(c.bot, guild, c.data.config)).filter((w) => !channel || w.channel_id === channel.id);
    if (removed.length === 0) {
      return c.ephemeral(
        <ui.Secondary>
          <Text>There were no composurejs release announcements to stop.</Text>
        </ui.Secondary>,
      );
    }
    for (const webhook of removed) {
      await deleteWebhook(c.bot, webhook.id, { reason: "/notify remove" }).catch((error: unknown) => {
        throw permissionError(error, webhook.channel_id ? `in ${mention(webhook.channel_id)}` : "in this server");
      });
    }
    return c.ephemeral(
      <ui.Success title="Announcements off">
        <Text>Stopped composurejs release announcements in {mentions(removed)}.</Text>
      </ui.Success>,
    );
  },
});

const status = command({
  name: "status",
  description: "Where composurejs release announcements go in this server",
  handler: async (c) => {
    const current = await followers(c.bot, guildOf(c), c.data.config);
    return c.ephemeral(
      current.length === 0 ? (
        <ui.Secondary title="Announcements off">
          <Text>Turn them on with `/notify setup`.</Text>
        </ui.Secondary>
      ) : (
        <ui.Secondary title="Announcements on">
          <Text>composurejs release announcements go to {mentions(current)}.</Text>
        </ui.Secondary>
      ),
    );
  },
});

const preview = command({
  name: "preview",
  description: "Show the latest release's announcement, only to you",
  handler: async (c) => {
    const [release] = await loadReleases(c.data);
    if (!release) throw new UserError("There are no releases yet.");
    return c.ephemeral(<Announcement release={release} />);
  },
});

export const notify = group({
  name: "notify",
  description: "Get composurejs release announcements in this server",
  subcommands: [setup, remove, status, preview],
  contexts: ["guild"],
  integrationTypes: ["guildInstall"],
  defaultMemberPermissions: Permission.ManageGuild,
});

/** The announcement of a release: its notes and links. Only link buttons, so it works wherever it is crossposted. */
export const Announcement = ({ release }: { release: Release }) => {
  const [notes, cut] = excerpt(tidy(release.notes), NOTES_LIMIT);
  const more = cut ? `\n\n-# … [Read the rest on GitHub](${release.url})` : "";
  return (
    <ui.Primary>
      <Text>## composurejs v{release.version} is out</Text>
      <Text>-# Released {release.date}</Text>
      <Separator />
      <Text>{(notes || "_No release notes._") + more}</Text>
      <Separator />
      <Row>
        <Button url={release.url}>Release notes</Button>
        <Button url={`https://www.npmjs.com/package/composurejs/v/${release.version}`}>npm</Button>
        <Button url={GUIDE}>Guide</Button>
      </Row>
    </ui.Primary>
  );
};

/**
 * The cron trigger's work: refreshes the stored releases, then posts and publishes every release
 * newer than the last one announced, oldest first. The first run (nothing announced yet) announces
 * every release, so the announcement channel starts with the full history. Returns the versions
 * announced.
 */
export async function announceNew(bot: BotClient, data: Data): Promise<string[]> {
  const { config, store } = data;
  const releases = await refreshReleases(data);
  const announced = await store.get(ANNOUNCED_KEY);
  let index = releases.length;
  if (announced !== null) {
    index = position(releases, announced);
    // That release was deleted: catch up to the latest without reposting history
    if (index === -1) {
      if (releases[0]) await store.put(ANNOUNCED_KEY, releases[0].version);
      return [];
    }
  }
  const done: string[] = [];
  for (const release of releases.slice(0, index).reverse()) {
    const message = await createMessage(bot, config.announceChannel, <Announcement release={release} />);
    // Already posted: a failed publish is logged, not retried, so it is never posted twice
    try {
      await crosspostMessage(bot, config.announceChannel, message.id);
    } catch (error) {
      console.warn({ msg: "could not publish the announcement", version: release.version, error: String(error) });
    }
    await store.put(ANNOUNCED_KEY, release.version);
    console.info({ msg: "announced release", version: release.version });
    done.push(release.version);
  }
  return done;
}
