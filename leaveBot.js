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

// ----------------- MODULE EXPORT -----------------
module.exports = (client) => {
  // ----------------- REGISTER SLASH COMMAND -----------------
  client.once(Events.ClientReady, async () => {
    try {
      const commands = [
        new SlashCommandBuilder()
          .setName("leave")
          .setDescription("Submit a leave request"),
      ].map((cmd) => cmd.toJSON());

      await client.application.commands.set(commands);
      console.log("Global /leave command registered ✅");
    } catch (err) {
      console.error("Error registering global command:", err);
    }
  });

  // ----------------- HANDLE SLASH COMMAND -----------------
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
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

    const approvalChannel = interaction.guild.channels.cache.find(
      (ch) => ch.name === "leave-approval"
    );

    if (!approvalChannel) {
      console.log("leave-approval channel not found");
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
        allowedMentions: { parse: ["roles"], roles: approvalRoleIds },
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
        timestamp: new Date().toISOString(),
      });

      await saveLeaves();
    }
  });

  // ----------------- HANDLE BUTTONS -----------------
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    const [action, userId, date] = interaction.customId.split("_");
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.reply({ content: "User not found ❌", ephemeral: true });

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const leaveChannel = interaction.guild.channels.cache.find(
      (ch) => ch.name === "🛏️leave-requests🛏️"
    );

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
          content: claimRoleIds.map((id) => `<@&${id}>`).join(" "),
          allowedMentions: { parse: ["roles"], roles: claimRoleIds },
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
    const approvalChannel = client.channels.cache.find((ch) => ch.name === "leave-approval");
    if (!approvalChannel) return;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const lastWeekLeaves = leaves.filter((l) => new Date(l.timestamp) >= sevenDaysAgo);

    if (lastWeekLeaves.length === 0) {
      approvalChannel.send("No leave requests in the last 7 days.");
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

    approvalChannel.send({ embeds: [reportEmbed] });
  });
};
