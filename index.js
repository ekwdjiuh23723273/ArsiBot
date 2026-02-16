const { Client, GatewayIntentBits, Partials } = require("discord.js");
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// load admin module FIRST (provides kill switches)
const admin = require("./adminBot")(client);

// load other modules
require("./hypeBot")(client, admin);
require("./leaveBot")(client, admin);
require("./raffleBot")(client, admin);

client.login(process.env.BOT_TOKEN);
