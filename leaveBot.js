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

module.exports = (client) => {
  // REGISTER GLOBAL SLASH COMMAND
  client.once(Events.ClientReady, async () => {
    try {
      const commands = [
        new SlashCommandBuilder()
          .setName("leave")
          .setDescription("Submit a leave request"),
      ].map(cmd => cmd.toJSON());

      await client.application.commands.set(commands);
      console.log("Global /leave command registered ✅");
    } catch (err) {
      console.error("Error registering global command:", err);
    }
  });

  //TESTING-----------------------------
  client.once(Events.ClientReady, async () => {
  const guild = client.guilds.cache.get("1416359796948467755");
  if (!guild) return;

  const cmds = await guild.commands.fetch();
  const leaveCmd = cmds.find(c => c.name === "leave");
  if (leaveCmd) {
    await leaveCmd.delete();
    console.log("Old guild /leave deleted ✅");
  }
});

//----------------------

  // HANDLE SLASH COMMAND
  client.on(Events.InteractionCreate, async interaction => {
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
      .setLabel("Date(s) (comma separated)")
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

  // HANDLE MODAL SUBMIT
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== "leaveModal") return;

    const name = interaction.fields.getTextInputValue("name");
    const dates = interaction.fields
      .getTextInputValue("dates")
      .split(",")
      .map(d => d.trim());

    const shift = interaction.fields.getTextInputValue("shift");
    const models = interaction.fields.getTextInputValue("models");
    const reason = interaction.fields.getTextInputValue("reason");

    await interaction.reply({
      content: "Leave request submitted ✅",
      ephemeral: true,
    });

    const leaveChannel = interaction.guild.channels.cache.find(
      ch => ch.name === "🛏️leave-requests🛏️"
    );

    if (!leaveChannel) {
      console.log("leave-requests channel not found");
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

      await leaveChannel.send({
        embeds: [embed],
        components: [buttons],
      });
    }
  });

  // HANDLE BUTTONS
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const [action, userId, date] = interaction.customId.split("_");
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      return interaction.reply({ content: "User not found ❌", ephemeral: true });
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);

    if (action === "approve") {
      await user.send(`Your leave for ${date} has been approved ✅`);

      embed
        .setColor("Green")
        .setFooter({ text: "Status: Approved" });

      const claimRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_${userId}_${date}`)
          .setLabel("Claim")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.update({
        embeds: [embed],
        components: [claimRow],
      });
    }

    if (action === "decline") {
      await user.send(
        `Your leave for ${date} has not been authorized ❌. Taking the day off will result in a fine.`
      );

      embed
        .setColor("Red")
        .setFooter({ text: "Status: Declined" });

      await interaction.update({
        embeds: [embed],
        components: [],
      });
    }

    if (action === "claim") {
      embed.setFooter({
        text: `Status: Claimed by ${interaction.user.username}`,
      });

      await interaction.update({
        embeds: [embed],
        components: [],
      });
    }
  });

};

