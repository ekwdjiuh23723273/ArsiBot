const { Client, GatewayIntentBits, Partials } = require("discord.js");
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// load modules
require("./hypeBot")(client);
require("./leaveBot")(client);
require("./raffleBot")(client);

client.login(process.env.BOT_TOKEN);
