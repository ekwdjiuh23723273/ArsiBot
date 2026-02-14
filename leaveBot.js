const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { Octokit } = require("@octokit/rest");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  Events,
} = require("discord.js");

// ----------------- CONFIG -----------------
const DATA_FILE = path.join(__dirname, "leaves.json");
const allowedRoles = ["1416521000798912677", "1416520509914615949"];

const approvalRoleIds = ["1416521000798912677", "1416520509914615949"];
const claimRoleIds = ["1416542249667264616"];
const claimRoleMentions = claimRoleIds.map((id) => `<@&${id}>`).join(" ");

const APPROVAL_CHANNEL_ID = process.env.LEAVE_APPROVAL_CHANNEL_ID || null;
const LEAVE_REQUESTS_CHANNEL_ID = process.env.LEAVE_REQUESTS_CHANNEL_ID || null;
const APPROVAL_CHANNEL_NAME = "leave-approval";
const LEAVE_REQUESTS_CHANNEL_NAME = "🛏️leave-requests🛏️";
const COVER_TZ = "America/New_York";
const WEEKLY_REPORT_CHANNEL_ID = "1467641541433757969";
const STICKY_NOTE_CHANNEL_ID = "1467626250196746565";

const GITHUB_OWNER = "ekwdjiuh23723273";
const GITHUB_REPO = "ArsiBot";
const GITHUB_PATH = "leaves.json";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// ----------------- LOAD LEAVES -----------------
let leaves = [];
if (fs.existsSync(DATA_FILE)) {
  leaves = JSON.parse(fs.readFileSync(DATA_FILE));
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify(leaves, null, 2));
}

// ----------------- SAVE FUNCTION -----------------
async function updateLeavesOnGitHub(leaves) {
  try {
    const { data: fileData } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: GITHUB_PATH,
    });

    const content = Buffer.from(JSON.stringify(leaves, null, 2)).toString("base64");

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: GITHUB_PATH,
      message: "Update leaves.json",
      content,
      sha: fileData.sha,
    });

    console.log("leaves.json synced to GitHub ✅");
  } catch (err) {
    console.error("Failed to sync leaves.json to GitHub:", err);
  }
}

async function saveLeaves() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(leaves, null, 2));
  await updateLeavesOnGitHub(leaves);
}

function normalizeChannelName(name) {
  return name?.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function parseDateMdY(dateStr) {
  const parts = dateStr.split("/").map((p) => p.trim());
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  let year = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseShiftStart(shiftText) {
  if (!shiftText) return null;
  const match = shiftText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const ampm = match[3]?.toLowerCase();

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }

  return { hour, minute };
}

function getTimeZoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - date.getTime();
}

function makeDateInTimeZone(year, month, day, hour, minute, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMs = getTimeZoneOffset(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMs);
}

async function findChannel(guild, { id, name, normalizedTarget }) {
  if (!guild) return null;

  if (id) {
    const byId = await guild.channels.fetch(id).catch(() => null);
    if (byId) return byId;
  }

  if (name) {
    const byName = guild.channels.cache.find((ch) => ch.name === name);
    if (byName) return byName;
  }

  if (normalizedTarget) {
    const byNormalized = guild.channels.cache.find(
      (ch) => normalizeChannelName(ch.name) === normalizedTarget
    );
    if (byNormalized) return byNormalized;
  }

  return null;
}

const STICKY_NOTE_TEXT =
  "how to request leave:\n" +
  "## **how to request leave:**\n" +
  "go to **<#1467626250196746565>** and type **/leave**. fill the form and submit. management will approve or decline it. you will get a DM once reviewed.\n\n" +
  "## **date format:**\n" +
  "use **MM/DD/YYYY** (example: `02/15/2026`).\n" +
  "multiple dates can be separated with commas.\n\n" +
  "## **shift format (important):**\n" +
  "you MUST include a start time so reminders work. examples:\n" +
  "`9am day shift`\n" +
  "`2pm to 10pm`\n" +
  "`14:00 shift`\n" +
  "`night shift, starts 7pm`\n" +
  "for partial cover: `2pm to 6pm cover`\n\n" +
  "## **claiming shifts:**\n" +
  "when approved, <@&1416542249667264616> will be pinged in **<#1467626250196746565>**. click **Claim** to take the shift.\n\n"+
  "# Any requests not following this format will be DECLINED";

// ----------------- MODULE EXPORT -----------------
module.exports = (client) => {
  let stickyNoteMessageId = null;

  async function getLeaveRequestsChannel() {
    const guild = client.guilds.cache.first();
    const id = LEAVE_REQUESTS_CHANNEL_ID || STICKY_NOTE_CHANNEL_ID;
    return findChannel(guild, {
      id,
      name: LEAVE_REQUESTS_CHANNEL_NAME,
      normalizedTarget: "leave-requests",
    });
  }

  async function refreshStickyNote(channel) {
    if (!channel) return;
    if (stickyNoteMessageId) {
      await channel.messages.delete(stickyNoteMessageId).catch(() => null);
    }
    const sent = await channel.send({ content: STICKY_NOTE_TEXT, allowedMentions: { roles: [] } });
    stickyNoteMessageId = sent.id;
  }

  // ----------------- REGISTER SLASH COMMAND -----------------
  client.once(Events.ClientReady, async () => {
    try {
      const existing = await client.application.commands.fetch();
      if (!existing.some((cmd) => cmd.name === "leave")) {
        const command = new SlashCommandBuilder()
          .setName("leave")
          .setDescription("Submit a leave request")
          .toJSON();

        await client.application.commands.create(command);
        console.log("Global /leave command registered ✅");
      } else {
        console.log("Global /leave command already registered ✅");
      }

      if (!existing.some((cmd) => cmd.name === "coverage")) {
        const command = new SlashCommandBuilder()
          .setName("coverage")
          .setDescription("Show approved leave coverage status")
          .toJSON();

        await client.application.commands.create(command);
        console.log("Global /coverage command registered ✅");
      } else {
        console.log("Global /coverage command already registered ✅");
      }
    } catch (err) {
      console.error("Error registering global command:", err);
    }

    const leaveChannel = await getLeaveRequestsChannel();
    await refreshStickyNote(leaveChannel);
  });

  // ----------------- HANDLE SLASH COMMAND -----------------
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "coverage") {
      const now = new Date();
      const approved = leaves
        .map((leave) => {
          const dateParts = parseDateMdY(leave.date);
          if (!dateParts) return null;
          const shiftStart = parseShiftStart(leave.shift);
          const coverTime = shiftStart
            ? makeDateInTimeZone(
                dateParts.year,
                dateParts.month,
                dateParts.day,
                shiftStart.hour,
                shiftStart.minute,
                COVER_TZ
              )
            : makeDateInTimeZone(
                dateParts.year,
                dateParts.month,
                dateParts.day,
                23,
                59,
                COVER_TZ
              );
          return { leave, coverTime, shiftStart };
        })
        .filter((entry) => entry && entry.leave.status === "Approved" && now < entry.coverTime)
        .sort((a, b) => a.coverTime - b.coverTime);

      if (approved.length === 0) {
        await interaction.reply({ content: "No upcoming approved leave shifts.", ephemeral: false });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Coverage Schedule")
        .setColor("Blue")
        .setTimestamp();

      approved.forEach(({ leave, coverTime, shiftStart }) => {
        const claimedBy = leave.claimedBy ? `<@${leave.claimedBy}>` : "Unclaimed";
        const timeLabel = shiftStart
          ? coverTime.toLocaleString("en-US", { timeZone: COVER_TZ })
          : "Time TBD";
        embed.addFields({
          name: `${leave.name} - ${leave.date}`,
          value: `Shift: ${leave.shift}\nCover time: ${timeLabel} ET\nModels: ${leave.models}\nCover: ${claimedBy}`,
        });
      });

      await interaction.reply({ embeds: [embed], ephemeral: false });
      return;
    }

    if (interaction.commandName !== "leave") return;

    const modal = new ModalBuilder()
      .setCustomId("leaveModal")
      .setTitle("Submit Leave Request");

    const nameInput = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("Your Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const dateInput = new TextInputBuilder()
      .setCustomId("dates")
      .setLabel("Date(s) (comma separated, MM/DD/YYYY)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const shiftInput = new TextInputBuilder()
      .setCustomId("shift")
      .setLabel("Shift")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const modelsInput = new TextInputBuilder()
      .setCustomId("models")
      .setLabel("Models affected")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(shiftInput),
      new ActionRowBuilder().addComponents(modelsInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );

    await interaction.showModal(modal);
  });

  // ----------------- HANDLE MODAL SUBMIT -----------------
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== "leaveModal") return;

    const name = interaction.fields.getTextInputValue("name");
    const dates = interaction.fields
      .getTextInputValue("dates")
      .split(",")
      .map((d) => d.trim());

    const shift = interaction.fields.getTextInputValue("shift");
    const models = interaction.fields.getTextInputValue("models");
    const reason = interaction.fields.getTextInputValue("reason");

    await interaction.reply({ content: "Leave request submitted ✅", ephemeral: true });

    const approvalChannel = await findChannel(interaction.guild, {
      id: APPROVAL_CHANNEL_ID,
      name: APPROVAL_CHANNEL_NAME,
      normalizedTarget: "leave-approval",
    });

    if (!approvalChannel) {
      console.log("leave-approval channel not found");
      await interaction.followUp({
        content:
          "Leave request could not be posted: approval channel not found. Set LEAVE_APPROVAL_CHANNEL_ID or rename the channel to leave-approval.",
        ephemeral: true,
      });
      return;
    }

    for (const date of dates) {
      const embed = new EmbedBuilder()
        .setTitle("Leave Request")
        .setColor("Yellow")
        .addFields(
          { name: "Chatter", value: name, inline: true },
          { name: "Date", value: date, inline: true },
          { name: "Shift", value: shift, inline: true },
          { name: "Models", value: models },
          { name: "Reason", value: reason }
        )
        .setFooter({ text: "Status: Pending" });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${interaction.user.id}_${date}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`decline_${interaction.user.id}_${date}`)
          .setLabel("Decline")
          .setStyle(ButtonStyle.Danger)
      );

      await approvalChannel.send({
        content: approvalRoleIds.map((id) => `<@&${id}>`).join(" "),
        allowedMentions: { roles: approvalRoleIds },
        embeds: [embed],
        components: [buttons],
      });

      leaves.push({
        userId: interaction.user.id,
        name,
        date,
        shift,
        models,
        reason,
        status: "Pending",
        approverId: null,
        claimedBy: null,
        reminderSentAt: null,
        timestamp: new Date().toISOString(),
      });

      await saveLeaves();
    }
  });

  // ----------------- STICKY NOTE -----------------
  client.on(Events.MessageCreate, async (message) => {
    if (message.author?.id === client.user?.id) return;
    const leaveChannel = await getLeaveRequestsChannel();
    if (!leaveChannel || message.channel.id !== leaveChannel.id) return;
    await refreshStickyNote(leaveChannel);
  });

  // ----------------- HANDLE BUTTONS -----------------
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    const [action, userId, date] = interaction.customId.split("_");
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.reply({ content: "User not found ❌", ephemeral: true });

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const leaveChannel = await findChannel(interaction.guild, {
      id: LEAVE_REQUESTS_CHANNEL_ID,
      name: LEAVE_REQUESTS_CHANNEL_NAME,
      normalizedTarget: "leave-requests",
    });

    const leave = leaves.find((l) => l.userId === userId && l.date === date);

    // Only allow specific roles for approve/decline
    if ((action === "approve" || action === "decline") &&
        !interaction.member.roles.cache.some((r) => allowedRoles.includes(r.id))) {
      return interaction.reply({ content: "You cannot approve/decline ❌", ephemeral: true });
    }

    if (action === "approve") {
      await interaction.deferUpdate();
      await user.send(`Your leave for ${date} has been approved ✅`).catch(() => null);
      embed.setColor("Green").setFooter({ text: "Status: Approved" });

      const claimRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_${userId}_${date}`)
          .setLabel("Claim")
          .setStyle(ButtonStyle.Primary)
      );

      if (leaveChannel) {
        await leaveChannel.send({
          content: claimRoleMentions,
          allowedMentions: { roles: claimRoleIds },
          embeds: [embed],
          components: [claimRow],
        });
      }

      if (leave) {
        leave.status = "Approved";
        leave.approverId = interaction.user.id;
        await saveLeaves();
      }

      await interaction.editReply({ content: "Leave approved ✅", embeds: [], components: [] });
    }

    if (action === "decline") {
      await interaction.deferUpdate();
      await user
        .send(
          `Your leave for ${date} has not been authorized ❌. Taking the day off will result in a fine.`
        )
        .catch(() => null);

      embed.setColor("Red").setFooter({ text: "Status: Declined" });

      if (leaveChannel) await leaveChannel.send({ embeds: [embed], components: [] });

      if (leave) {
        leave.status = "Declined";
        leave.approverId = interaction.user.id;
        await saveLeaves();
      }

      await interaction.editReply({ content: "Leave declined ❌", embeds: [], components: [] });
    }

    if (action === "claim") {
      embed
        .setFooter({ text: `Status: Claimed by ${interaction.user.username}` })
        .setColor("Yellow");

      if (leave) {
        leave.claimedBy = interaction.user.id;
        await saveLeaves();
      }

      await interaction.update({ embeds: [embed], components: [] });
    }
  });

  // ----------------- WEEKLY REPORT -----------------
  cron.schedule("0 8 * * 1", async () => {
    const reportChannel = await findChannel(client.guilds.cache.first(), {
      id: WEEKLY_REPORT_CHANNEL_ID,
    });
    if (!reportChannel) return;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const lastWeekLeaves = leaves.filter((l) => new Date(l.timestamp) >= sevenDaysAgo);

    if (lastWeekLeaves.length === 0) {
      reportChannel.send("No leave requests in the last 7 days.");
      return;
    }

    const reportEmbed = new EmbedBuilder()
      .setTitle("Weekly Leave Report")
      .setColor("Blue")
      .setTimestamp();

    lastWeekLeaves.forEach((l) => {
      reportEmbed.addFields({
        name: `${l.name} - ${l.date}`,
        value: `Status: ${l.status}\nShift: ${l.shift}\nModels: ${l.models}\nClaimed by: ${
          l.claimedBy ? `<@${l.claimedBy}>` : "None"
        }\nApproved by: ${l.approverId ? `<@${l.approverId}>` : "None"}`,
      });
    });

    reportChannel.send({ embeds: [reportEmbed] });
  });

  // ----------------- COVER TIME REMINDERS -----------------
  cron.schedule(
    "*/5 * * * *",
    async () => {
      const leaveChannel = await findChannel(client.guilds.cache.first(), {
        id: LEAVE_REQUESTS_CHANNEL_ID,
        name: LEAVE_REQUESTS_CHANNEL_NAME,
        normalizedTarget: "leave-requests",
      });

      const now = new Date();

      for (const leave of leaves) {
        if (leave.status !== "Approved" || !leave.claimedBy) continue;
        if (leave.reminderSentAt) continue;

        const dateParts = parseDateMdY(leave.date);
        const shiftStart = parseShiftStart(leave.shift);
        if (!dateParts || !shiftStart) continue;

        const coverTime = makeDateInTimeZone(
          dateParts.year,
          dateParts.month,
          dateParts.day,
          shiftStart.hour,
          shiftStart.minute,
          COVER_TZ
        );

        const reminderTime = new Date(coverTime.getTime() - 12 * 60 * 60 * 1000);
        if (now < reminderTime || now >= coverTime) continue;

        const claimer = await client.users.fetch(leave.claimedBy).catch(() => null);
        if (!claimer) continue;

        const message =
          `⏰ Reminder: your cover time is in 12 hours for ${leave.date} (${leave.shift}). Models: ${leave.models}.`;

        if (leaveChannel) {
          await leaveChannel.send({ content: `<@${leave.claimedBy}> ${message}` });
        }

        await claimer.send(message).catch(() => null);

        leave.reminderSentAt = new Date().toISOString();
        await saveLeaves();
      }
    },
    { timezone: COVER_TZ }
  );
};


