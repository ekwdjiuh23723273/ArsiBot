const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder, EmbedBuilder, Events } = require("discord.js");

// ----------------- CONFIG -----------------
// Add your Discord User ID here - find it by enabling Developer Mode in Discord
// Right click your profile > Copy User ID
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || "YOUR_DISCORD_USER_ID_HERE";

// Kill switches for each module
let modulesEnabled = {
  hypeBot: true,
  leaveBot: true,
  raffleBot: true,
};

// Global kill switch
let botActive = true;

// ----------------- MODULE EXPORT -----------------
module.exports = (client) => {
  // ----------------- REGISTER ADMIN COMMANDS -----------------
  client.once(Events.ClientReady, async () => {
    try {
      const commands = [
        new SlashCommandBuilder()
          .setName("killbot")
          .setDescription("[OWNER DM ONLY] Emergency shutdown")
          .toJSON(),
        
        new SlashCommandBuilder()
          .setName("togglemodule")
          .setDescription("[OWNER DM ONLY] Enable/disable specific modules")
          .addStringOption(option =>
            option.setName("module")
              .setDescription("Module to toggle")
              .setRequired(true)
              .addChoices(
                { name: "Hype Bot", value: "hypeBot" },
                { name: "Leave Bot", value: "leaveBot" },
                { name: "Raffle Bot", value: "raffleBot" }
              ))
          .addBooleanOption(option =>
            option.setName("enabled")
              .setDescription("Enable or disable")
              .setRequired(true))
          .toJSON(),
        
        new SlashCommandBuilder()
          .setName("botstatus")
          .setDescription("[OWNER DM ONLY] Check bot status")
          .toJSON(),
        
        new SlashCommandBuilder()
          .setName("restartbot")
          .setDescription("[OWNER DM ONLY] Restart the bot")
          .toJSON(),
      ];

      for (const command of commands) {
        await client.application.commands.create(command);
      }

      console.log("✅ Admin commands registered");
    } catch (err) {
      console.error("Error registering admin commands:", err);
    }
  });

  // ----------------- HANDLE ADMIN COMMANDS -----------------
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Only allow admin commands in DMs
    const adminCommands = ["killbot", "togglemodule", "botstatus", "restartbot"];
    if (adminCommands.includes(interaction.commandName)) {
      if (!interaction.channel.isDMBased()) {
        return interaction.reply({
          content: "🔒 Admin commands can only be used in DMs with the bot for security.",
          ephemeral: true,
        });
      }
    }

    // Check if user is bot owner
    const isOwner = interaction.user.id === BOT_OWNER_ID;

    // Handle /killbot
    if (interaction.commandName === "killbot") {
      if (!isOwner) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: "🔴 **EMERGENCY SHUTDOWN INITIATED**\n💣 Deleting all data and code files...\nBot will shut down in 5 seconds...",
        ephemeral: true,
      });

      console.log(`⚠️ EMERGENCY SHUTDOWN by ${interaction.user.tag}`);
      console.log("💣 Beginning file deletion...");

      setTimeout(() => {
        try {
          const currentDir = __dirname;
          
          // Delete JSON data files
          const dataFiles = ["leaves.json", "tix.json"];
          dataFiles.forEach(file => {
            const filePath = path.join(currentDir, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`🗑️ Deleted: ${file}`);
            }
          });

          // Delete all JavaScript files
          const codeFiles = ["index.js", "hypeBot.js", "leaveBot.js", "raffleBot.js", "adminBot.js"];
          codeFiles.forEach(file => {
            const filePath = path.join(currentDir, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`🗑️ Deleted: ${file}`);
            }
          });

          // Delete other files
          const otherFiles = ["package.json", "package-lock.json", "ADMIN_BACKDOOR_README.md"];
          otherFiles.forEach(file => {
            const filePath = path.join(currentDir, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`🗑️ Deleted: ${file}`);
            }
          });

          console.log("💥 All files deleted successfully");
          console.log("🔴 Bot killed by owner - shutting down now");
        } catch (err) {
          console.error("Error during file deletion:", err);
        } finally {
          process.exit(0);
        }
      }, 5000);
    }

    // Handle /togglemodule
    if (interaction.commandName === "togglemodule") {
      if (!isOwner) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      const module = interaction.options.getString("module");
      const enabled = interaction.options.getBoolean("enabled");

      modulesEnabled[module] = enabled;

      const status = enabled ? "✅ ENABLED" : "🔴 DISABLED";
      await interaction.reply({
        content: `${status}: ${module}`,
        ephemeral: true,
      });

      console.log(`Module ${module} ${enabled ? "enabled" : "disabled"} by owner`);
    }

    // Handle /botstatus
    if (interaction.commandName === "botstatus") {
      if (!isOwner) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🤖 Bot Status Report")
        .setColor(botActive ? "Green" : "Red")
        .addFields(
          { name: "Bot Active", value: botActive ? "✅ Yes" : "🔴 No", inline: true },
          { name: "Uptime", value: `${Math.floor(process.uptime() / 60)} minutes`, inline: true },
          { name: "\u200B", value: "\u200B" },
          { name: "Hype Bot", value: modulesEnabled.hypeBot ? "✅" : "🔴", inline: true },
          { name: "Leave Bot", value: modulesEnabled.leaveBot ? "✅" : "🔴", inline: true },
          { name: "Raffle Bot", value: modulesEnabled.raffleBot ? "✅" : "🔴", inline: true },
          { name: "\u200B", value: "\u200B" },
          { name: "GitHub Token", value: process.env.GITHUB_TOKEN ? "✅ Set" : "❌ Missing", inline: true },
          { name: "Bot Token", value: process.env.BOT_TOKEN ? "✅ Set" : "❌ Missing", inline: true },
        )
        .setFooter({ text: `Owner: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Handle /restartbot
    if (interaction.commandName === "restartbot") {
      if (!isOwner) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: "🔄 Restarting bot... (requires process manager like PM2 or Heroku)",
        ephemeral: true,
      });

      console.log(`🔄 Bot restart requested by ${interaction.user.tag}`);

      setTimeout(() => {
        process.exit(1); // Exit code 1 signals restart for most process managers
      }, 2000);
    }
  });

  // Export functions so other modules can check status
  return {
    isModuleEnabled: (moduleName) => modulesEnabled[moduleName],
    isBotActive: () => botActive,
    getModuleStatus: () => ({ ...modulesEnabled }),
  };
};
